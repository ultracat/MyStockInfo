import crypto from 'node:crypto';
import { getCredentialFields, hasCredential } from '../../credentials';
import { RateLimiter } from '../rateLimiter';
import { getDataDir } from '../../paths';
import { JsonStore } from '../../jsonStore';
import { PORTFOLIO_TTL_MS, withCache } from '../responseCache';
import type { FetchOpts } from '../types';

// 키움증권 REST API. 정본: 공식 저장소 github.com/Kiwoom-Securities/Kiwoom-REST-API의 `kiwoom/_data/kiwoom_api_spec.json`
// (API 337개 명세 + 요청/응답 예시)와 공식 SDK `kiwoom/core/client.py`·`auth.py`, 포털 openapi.kiwoom.com/guide/apiguide.
//
// ⚠⚠ **실제 키로 한 번도 호출해 보지 않았다**(2026-11-09 — 개발자에게 키움 계좌가 없음). 요청 모양·필드명은 명세와
//    공식 예시 그대로지만, 응답 해석(거래내역 적요로 배당·입출금 가르기, 금액 세전/세후, 해외 거래 행의 종목코드 형식,
//    조회 기간 제한, 호출 한도)은 실키로 확인해야 한다 — 키를 받으면 `npm run check:kiwoom`부터 돌릴 것.
//
// 규약(명세·SDK):
// - 모든 API가 `POST` + JSON 본문. 헤더 `api-id`(TR, 예: kt00018) + `authorization: Bearer <token>`.
// - **업무 오류도 HTTP 200**으로 오고 본문 `return_code`(0=정상)·`return_msg`에 담긴다(SDK가 그렇게 판정).
// - 연속조회는 응답 **헤더** `cont-yn`(Y=다음 있음)·`next-key` → 다음 요청 헤더에 그대로.
// - **앱키가 계좌 하나에 묶인다** — 계좌번호조회(ka00001)가 `acctNo` 하나만 주고, 잔고·거래 API 요청에 계좌번호 칸이 없다.
// - 토큰을 받은 IP와 요청 IP가 다르면 실패(8010). 포털에 사용할 PC의 IP를 등록해야 한다.
// - 금액은 "000000017598258"/"-00000000196888"처럼 0으로 채운 부호 포함 문자열, 미국 금액은 "156464.6701" 같은 소수 문자열.
const BASE_URL = 'https://api.kiwoom.com';

// 공개된 초당 한도 수치가 없다(오류코드 1700 API별·1701 전체·1702 그룹 초과만 있음). 공식 예제가 페이지 사이에 0.2초를
// 쉬어서, 그보다 보수적인 초당 3건으로 시작한다 — 실키로 한도를 확인하면 조정.
const kiwoomLimiter = new RateLimiter({ tps: 3 }, 'KIWOOM');
const MAX_PAGES = 50;

export class KiwoomApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: string, readonly returnCode: number | null = null) {
    super(message);
    this.name = 'KiwoomApiError';
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isKiwoomConfigured(): boolean {
  return hasCredential('kiwoom');
}

function requireCredentials() {
  const creds = getCredentialFields('kiwoom');
  if (!creds) throw new Error('키움증권 API 키가 설정되지 않았습니다. 설정 화면에서 앱키/시크릿키를 입력해주세요.');
  return creds;
}

// ── 토큰 ───────────────────────────────────────────────────────────────────────
// 응답 `expires_dt`(YYYYMMDDHHmmss, KST로 본다)까지 재사용. 백엔드 재시작(백엔드 수정마다)에도 다시 받지 않게 파일에
// 저장하고, 앱키 해시로 키 변경을 감지한다(앱키 원문은 저장하지 않음). 동시 요청은 발급 하나를 공유한다.
interface StoredKiwoomToken {
  accessToken: string;
  expiresAt: number;
  keyHash: string;
}

const tokenStore = () => new JsonStore<StoredKiwoomToken | null>('kiwoom-token.json', getDataDir(), null);
let cachedToken: StoredKiwoomToken | null = null;
let inFlightToken: Promise<string> | null = null;

const keyHash = (appKey: string) => crypto.createHash('sha256').update(appKey).digest('hex').slice(0, 16);

/** `expires_dt` "20241107083713"(KST) → epoch ms. 형식이 다르면 24시간 뒤로 본다. */
export function parseKiwoomExpiry(value: unknown): number {
  const s = String(value ?? '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return Date.now() + 24 * 3600_000;
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
}

function loadCachedToken(hash: string): StoredKiwoomToken | null {
  const valid = (t: StoredKiwoomToken | null) => t && t.keyHash === hash && t.expiresAt > Date.now();
  if (valid(cachedToken)) return cachedToken;
  const persisted = tokenStore().read();
  if (valid(persisted)) return (cachedToken = persisted);
  return null;
}

async function issueToken(): Promise<string> {
  const creds = requireCredentials();
  const res = await kiwoomLimiter.schedule(() =>
    fetch(`${BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=UTF-8', 'api-id': 'au10001' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: creds.appKey, secretkey: creds.appSecret }),
    })
  );
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    /* 아래에서 처리 */
  }
  const code = returnCodeOf(data);
  if (!res.ok || (code !== null && code !== 0) || typeof data.token !== 'string') {
    throw new KiwoomApiError(`키움증권 토큰 발급 실패${code ? ` (${code})` : ''}: ${data.return_msg ?? res.status}`, res.status, text, code);
  }
  // 만료 1분 전부터는 새로 받는다.
  cachedToken = { accessToken: data.token, expiresAt: parseKiwoomExpiry(data.expires_dt) - 60_000, keyHash: keyHash(creds.appKey) };
  tokenStore().write(cachedToken);
  return cachedToken.accessToken;
}

async function getToken(force = false): Promise<string> {
  if (!force) {
    const t = loadCachedToken(keyHash(requireCredentials().appKey));
    if (t) return t.accessToken;
  }
  if (!inFlightToken) inFlightToken = issueToken().finally(() => (inFlightToken = null));
  return inFlightToken;
}

// ── 호출 ───────────────────────────────────────────────────────────────────────
export type KiwoomBody = Record<string, unknown> & { return_code?: unknown; return_msg?: unknown };

export function returnCodeOf(body: Record<string, unknown>): number | null {
  const v = body.return_code;
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 토큰을 다시 받아야 하는 실패 — 8005(토큰 무효), 8010(토큰 발급 IP ≠ 요청 IP: IP가 바뀐 뒤엔 새로 받으면 통한다).
 *  SDK 주석: 만료 토큰은 return_code=8005로도, return_code=3 + return_msg "[8005:...]"로도 온다. */
export function needsNewToken(status: number, body: Record<string, unknown>): boolean {
  if (status === 401) return true;
  const code = returnCodeOf(body);
  if (code === 8005 || code === 8010) return true;
  return /\[(8005|8010)\b/.test(String(body.return_msg ?? ''));
}

/** 호출 한도 초과 — 1700(API별)·1701(전체)·1702(그룹) 또는 HTTP 429. */
export function isRateLimited(status: number, body: Record<string, unknown>): boolean {
  const code = returnCodeOf(body);
  return status === 429 || code === 1700 || code === 1701 || code === 1702;
}

export interface KiwoomPage {
  body: KiwoomBody;
  contYn: string | null;
  nextKey: string | null;
}

export async function kiwoomPost(
  path: string,
  apiId: string,
  body: Record<string, string>,
  cont?: { contYn: string; nextKey: string }
): Promise<KiwoomPage> {
  return kiwoomLimiter.schedule(async () => {
    let force = false;
    for (let attempt = 0; ; attempt++) {
      const token = await getToken(force);
      const headers: Record<string, string> = {
        'content-type': 'application/json;charset=UTF-8',
        'api-id': apiId,
        authorization: `Bearer ${token}`,
      };
      if (cont) {
        headers['cont-yn'] = cont.contYn;
        headers['next-key'] = cont.nextKey;
      }
      const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
      const text = await res.text();
      let json: KiwoomBody = {};
      try {
        json = JSON.parse(text);
      } catch {
        if (res.ok) throw new KiwoomApiError(`키움증권 응답 파싱 실패: ${apiId}`, res.status, text);
      }

      if (!force && needsNewToken(res.status, json)) {
        force = true;
        continue;
      }
      if (isRateLimited(res.status, json) && attempt < 3) {
        const backoffMs = 2 ** attempt * 1000 + Math.random() * 250;
        kiwoomLimiter.penalizeUntil(Date.now() + backoffMs);
        await sleep(backoffMs);
        continue;
      }
      const code = returnCodeOf(json);
      if (!res.ok || (code !== null && code !== 0)) {
        throw new KiwoomApiError(
          `키움증권 API 오류 ${apiId}${code !== null ? ` (${code})` : ''}: ${json.return_msg ?? res.status}`,
          res.ok ? 502 : res.status,
          text,
          code
        );
      }
      return {
        body: json,
        contYn: (res.headers.get('cont-yn') ?? '').trim() || null,
        nextKey: (res.headers.get('next-key') ?? '').trim() || null,
      };
    }
  });
}

/** 연속조회를 끝까지(`cont-yn=Y`인 동안). 같은 next-key가 다시 오면 멈춘다(무한루프 방지). */
export async function kiwoomPostAll(path: string, apiId: string, body: Record<string, string>): Promise<KiwoomBody[]> {
  const pages: KiwoomBody[] = [];
  let cont: { contYn: string; nextKey: string } | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await kiwoomPost(path, apiId, body, cont);
    pages.push(page.body);
    if ((page.contYn ?? '').toUpperCase() !== 'Y' || !page.nextKey) break;
    if (cont && cont.nextKey === page.nextKey) break;
    cont = { contYn: 'Y', nextKey: page.nextKey };
  }
  return pages;
}

/** 응답 본문의 배열 필드(예: `acnt_evlt_remn_indv_tot`). 없거나 배열이 아니면 빈 배열. */
export function listOf(body: KiwoomBody, key: string): Record<string, unknown>[] {
  const v = body[key];
  return Array.isArray(v) ? v.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
}

const compact = (date: string) => date.replace(/-/g, '');
const DOMESTIC = '/api/dostk/acnt';
const US = '/api/us/acnt';

// ── 계좌 ───────────────────────────────────────────────────────────────────────
/** 계좌번호조회(ka00001) — 앱키에 묶인 계좌 하나. 10자리(뒤 2자리는 키움 내부 분류값). */
export function fetchKiwoomAccountNo(opts: FetchOpts = {}): Promise<string> {
  return withCache(
    'kiwoom:account',
    60 * 60_000,
    async () => {
      const { body } = await kiwoomPost(DOMESTIC, 'ka00001', {});
      const acct = String(body.acctNo ?? '').trim();
      if (!acct) throw new KiwoomApiError('키움증권 계좌번호조회(ka00001) 응답에 계좌번호가 없습니다', 502, JSON.stringify(body));
      return acct;
    },
    opts
  );
}

// ── 잔고·예수금 ────────────────────────────────────────────────────────────────
/** 계좌평가잔고내역(kt00018) — 요약은 본문 최상위, 종목은 `acnt_evlt_remn_indv_tot`. `qry_tp=1`(합산),
 *  국내거래소 KRX(명세 필수값 — NXT 체결분이 따로 잡히는지는 실키로 확인). */
export function fetchKiwoomDomesticBalance(opts: FetchOpts = {}) {
  return withCache(
    'kiwoom:balance',
    PORTFOLIO_TTL_MS,
    async () => {
      const pages = await kiwoomPostAll(DOMESTIC, 'kt00018', { qry_tp: '1', dmst_stex_tp: 'KRX' });
      return { summary: pages[0] ?? {}, items: pages.flatMap((p) => listOf(p, 'acnt_evlt_remn_indv_tot')) };
    },
    opts
  );
}

/** 예수금상세현황(kt00001, 일반조회 2) — `entr`가 원화 예수금. */
export function fetchKiwoomDeposit(opts: FetchOpts = {}) {
  return withCache('kiwoom:deposit', PORTFOLIO_TTL_MS, async () => (await kiwoomPost(DOMESTIC, 'kt00001', { qry_tp: '2' })).body, opts);
}

/** 미국주식 원장잔고확인(ust21070) — 거래소 전체. 요약(USD·원화) + `result_list`. */
export function fetchKiwoomUsBalance(opts: FetchOpts = {}) {
  return withCache(
    'kiwoom:us-balance',
    PORTFOLIO_TTL_MS,
    async () => {
      const pages = await kiwoomPostAll(US, 'ust21070', { stex_tp: '', stk_cd: '' });
      return { summary: pages[0] ?? {}, items: pages.flatMap((p) => listOf(p, 'result_list')) };
    },
    opts
  );
}

/** 해외주식 예수금(ust21110) — 통화별 `result_list`, USD 줄의 `fc_entra`가 달러 예수금. */
export function fetchKiwoomUsDeposit(opts: FetchOpts = {}) {
  return withCache('kiwoom:us-deposit', PORTFOLIO_TTL_MS, async () => (await kiwoomPost(US, 'ust21110', {})).body, opts);
}

// ── 위탁종합거래내역(kt00015) — 매매·배당·입출금의 원천 ──────────────────────────
/** `tp`: 1 입출금 · 2 입출고 · 4 매수 · 5 매도 · 6 입금 · 7 출금. `gds_tp`: 0 전체 · 1 국내주식 · 3 해외주식.
 *  조회 기간 제한이 명세에 없다 — 긴 기간은 1년 단위로 나눠 부른다(제한이 있어도 한 번에 1년이면 안전하리라 보는 가정,
 *  실키로 확인). 과거거래순(2). */
export function fetchKiwoomTransactions(
  from: string,
  to: string,
  tp: '1' | '2' | '4' | '5' | '6' | '7',
  gdsTp: '0' | '1' | '3',
  opts: FetchOpts = {}
): Promise<Record<string, unknown>[]> {
  return withCache(
    `kiwoom:txn:${tp}:${gdsTp}:${from}:${to}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const rows: Record<string, unknown>[] = [];
      for (const [a, b] of yearWindows(from, to)) {
        const pages = await kiwoomPostAll(DOMESTIC, 'kt00015', {
          strt_dt: compact(a),
          end_dt: compact(b),
          tp,
          stk_cd: '',
          crnc_cd: '',
          gds_tp: gdsTp,
          frgn_stex_code: '',
          dmst_stex_tp: '%',
          qry_sort_tp: '2',
        });
        rows.push(...pages.flatMap((p) => listOf(p, 'trst_ovrl_trde_prps_array')));
      }
      return rows;
    },
    opts
  );
}

/** [from, to]를 최대 1년(같은 해) 구간으로 나눈다. YYYY-MM-DD. */
export function yearWindows(from: string, to: string): Array<[string, string]> {
  if (from > to) return [];
  const out: Array<[string, string]> = [];
  let start = from;
  while (start <= to) {
    const yearEnd = `${start.slice(0, 4)}-12-31`;
    const end = yearEnd < to ? yearEnd : to;
    out.push([start, end]);
    start = `${Number(start.slice(0, 4)) + 1}-01-01`;
  }
  return out;
}

// ── 공식 실현손익 ──────────────────────────────────────────────────────────────
/** 일자별종목별실현손익_기간(ka10073) — 매도 건(일자·종목)별 `dt_stk_rlzt_pl`. */
export async function fetchKiwoomDomesticRealized(from: string, to: string): Promise<Record<string, unknown>[]> {
  const pages = await kiwoomPostAll(DOMESTIC, 'ka10073', { stk_cd: '', strt_dt: compact(from), end_dt: compact(to) });
  return pages.flatMap((p) => listOf(p, 'dt_stk_rlzt_pl'));
}

/** 미국주식 실현손익(ust21530) — **원화(1)** 기준, 매도 건별 `result_list`. */
export async function fetchKiwoomUsRealized(from: string, to: string): Promise<Record<string, unknown>[]> {
  const pages = await kiwoomPostAll(US, 'ust21530', { strt_dt: compact(from), end_dt: compact(to), fc_krw_tp: '1' });
  return pages.flatMap((p) => listOf(p, 'result_list'));
}
