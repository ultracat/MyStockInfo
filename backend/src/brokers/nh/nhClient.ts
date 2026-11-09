import crypto from 'node:crypto';
import { getCredentialFields, hasCredential } from '../../credentials';
import { RateLimiter } from '../rateLimiter';
import { getDataDir } from '../../paths';
import { JsonStore } from '../../jsonStore';
import { PORTFOLIO_TTL_MS, withCache } from '../responseCache';
import type { FetchOpts } from '../types';

// NH투자증권 나무(Namuh) Open API — "NHPLUG". 정본은 포털의 `llms-full.txt`와 자산군별 `openapi.json`
// (www.nhplug.com/openapi-docs/{common,krstock,gbstock}/openapi.json, 2026-11-06 개정판 기준)과 공식 SDK
// github.com/PLUG-OpenAPI/nhplug-sdk(nhplug/client.py·auth.py). 필드명은 전부 그 명세에서 가져왔다.
//
// ⚠ **실데이터로 검증하지 못했다** — 개발자에게 나무증권 계좌가 없어 키를 발급받을 수 없다(2026-11-09).
//   요청 형식·필드는 명세 그대로이고, 응답 해석(적요 문구로 매수/매도·배당 판별, 금액이 세전/세후인지)은
//   명세에 없는 부분이라 가정이다. 가정한 곳마다 "⚠ 가정"으로 표시해 두었다(nhMappers.ts).
//
// 규약(명세 「공통 규약」):
// - REST는 전부 `POST` + JSON `{ "Input_0": {...} }`, 응답은 `Output_0`/`Output_1` + `rsp_cd`/`rsp_msg`.
// - 인증 헤더는 `Authorization: Bearer` 하나뿐(앱키를 요청마다 싣지 않는다).
// - **HTTP 200이 곧 성공은 아니다** — 정상 `rsp_cd`가 API마다 달라 코드 비교로 판정하지 말라고 명시돼 있다.
//   200이 아니면 게이트웨이 오류(IGW*)로 보고 던진다. 200이면 블록 유무로 본다(블록이 없으면 0건, 단 잔고처럼
//   요약 블록이 반드시 와야 하는 API는 호출부가 `rsp_msg`를 담아 던진다).
// - 연속조회 키는 응답 **헤더** `cts`/`cts_flag`로 온다(본문 아님). 같은 `cts`가 다시 오면 끝낸다(무한루프 방지).
const BASE_URL = 'https://api.nhplug.com:8443';
// 모의투자 — 계좌구분 03 계좌는 **이 도메인으로만** 조회된다(운영 도메인에 03 계좌를 쓰면 실패, 명세). 토큰은 운영에서
// 받은 것을 그대로 쓴다(모의투자는 토큰 발급 미제공 — 실키로 운영 토큰이 moapi 조회에 통하는 것 확인, 2026-11-09).
const MOCK_BASE_URL = 'https://moapi.nhplug.com:8443';

// 명세: REST 1초당 최대 5건. 공식 SDK 기본값(초당 4건)에 맞춘다.
const nhLimiter = new RateLimiter({ tps: 4 }, 'NH');

/** `cts_flag`가 없을 때 "다음 페이지가 있다"로 보는 응답코드(SDK `CONTINUE_CODES`, 실측값이라고 적혀 있다). */
const CONTINUE_CODES = new Set(['00165', '00218', 'XA109']);
const MAX_PAGES = 50;

export class NhApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = 'NhApiError';
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isNhConfigured(): boolean {
  return hasCredential('nh');
}

function requireCredentials() {
  const creds = getCredentialFields('nh');
  if (!creds) {
    throw new Error('NH투자증권(나무) API 키가 설정되지 않았습니다. 설정 화면에서 앱키/앱시크릿을 입력해주세요.');
  }
  return creds;
}

// ── 토큰 ───────────────────────────────────────────────────────────────────────
// 24시간 유효(expires_in=86400). **재발급할 때마다 계좌주에게 보안 알림이 간다**(명세) — 그래서 KIS처럼 파일에
// 저장해 백엔드 재시작(백엔드 수정마다 Electron 재시작) 뒤에도 재사용하고, 동시 요청은 발급 한 번을 공유한다.
// 재발급은 만료 또는 401(토큰 무효)일 때만. 429에는 재발급하지 않는다. 키를 바꾸면 이전 토큰을 쓰지 않도록
// 앱키 해시를 같이 저장한다(앱키 원문은 저장하지 않음).
interface StoredNhToken {
  accessToken: string;
  expiresAt: number;
  keyHash: string;
}

const tokenStore = () => new JsonStore<StoredNhToken | null>('nh-token.json', getDataDir(), null);
let cachedToken: StoredNhToken | null = null;
let inFlightToken: Promise<string> | null = null;

function keyHash(appKey: string): string {
  return crypto.createHash('sha256').update(appKey).digest('hex').slice(0, 16);
}

function loadCachedToken(hash: string): StoredNhToken | null {
  const valid = (t: StoredNhToken | null) => t && t.keyHash === hash && t.expiresAt > Date.now();
  if (valid(cachedToken)) return cachedToken;
  const persisted = tokenStore().read();
  if (valid(persisted)) {
    cachedToken = persisted;
    return cachedToken;
  }
  return null;
}

async function issueToken(): Promise<string> {
  const creds = requireCredentials();
  // 명세: 쿼리 파라미터 + Content-Type x-www-form-urlencoded(본문 없음). 토큰은 운영 도메인에서만 발급된다.
  const url = new URL('/oauth2/token', BASE_URL);
  url.searchParams.set('appkey', creds.appKey);
  url.searchParams.set('appsecretkey', creds.appSecret);
  url.searchParams.set('grant_type', 'client_credentials');
  url.searchParams.set('scope', 'oob');
  const res = await nhLimiter.schedule(() =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  );
  const text = await res.text();
  if (!res.ok) throw new NhApiError(`NH투자증권 토큰 발급 실패 (${gatewayCode(text) ?? res.status})`, res.status, text);
  let data: { access_token?: string; expires_in?: number };
  try {
    data = JSON.parse(text);
  } catch {
    throw new NhApiError('NH투자증권 토큰 응답을 해석하지 못했습니다', res.status, text);
  }
  if (!data.access_token) throw new NhApiError('NH투자증권 토큰 응답에 access_token이 없습니다', res.status, text);
  const expiresInSec = Number(data.expires_in) > 0 ? Number(data.expires_in) : 86400;
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (expiresInSec - 60) * 1000,
    keyHash: keyHash(creds.appKey),
  };
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
function gatewayCode(text: string): string | null {
  return /IGW\d{5}/.exec(text)?.[0] ?? null;
}

/** 토큰 무효 신호만 좁게(SDK `_is_invalid_token`): 401, IGW40043(유효하지 않은 토큰), IGW40044(만료). */
function isInvalidToken(status: number, text: string): boolean {
  return status === 401 || /IGW4004[34]/.test(text);
}

/** IGW42901~3(시스템·앱·앱+API 호출 한도 초과) 또는 HTTP 429. */
function isRateLimited(status: number, text: string): boolean {
  return status === 429 || /IGW429\d\d/.test(text);
}

export type NhBody = Record<string, unknown> & { rsp_cd?: string; rsp_msg?: string };

export interface NhPage {
  body: NhBody;
  cts: string | null;
  ctsFlag: string | null;
}

export async function nhPost(
  path: string,
  input: Record<string, string>,
  cont?: { cts: string; ctsFlag: string | null },
  base: string = BASE_URL
): Promise<NhPage> {
  return nhLimiter.schedule(async () => {
    let force = false;
    for (let attempt = 0; ; attempt++) {
      const token = await getToken(force);
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
      };
      if (cont?.cts) headers.cts = cont.cts;
      if (cont?.ctsFlag) headers.cts_flag = cont.ctsFlag;
      const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify({ Input_0: input }) });
      const text = await res.text();

      if (!res.ok) {
        if (!force && isInvalidToken(res.status, text)) {
          force = true;
          continue;
        }
        if (isRateLimited(res.status, text) && attempt < 3) {
          const backoffMs = 2 ** attempt * 1000 + Math.random() * 250;
          nhLimiter.penalizeUntil(Date.now() + backoffMs);
          await sleep(backoffMs);
          continue;
        }
        const code = gatewayCode(text);
        throw new NhApiError(`NH투자증권 API 오류${code ? ` (${code})` : ''}: ${path}`, res.status, text);
      }

      let body: NhBody;
      try {
        body = JSON.parse(text);
      } catch {
        throw new NhApiError(`NH투자증권 API 응답 파싱 실패: ${path}`, res.status, text);
      }
      const cts = (res.headers.get('cts') ?? '').trim() || null;
      const ctsFlag = (res.headers.get('cts_flag') ?? '').trim() || null;
      return { body, cts, ctsFlag };
    }
  });
}

/** 다음 페이지가 있는지 — SDK `Meta.has_next`와 같은 규칙(본문 `ctsz*` 폴백은 2026-09 명세에서 삭제돼 뺐다). */
export function hasNextPage(page: Pick<NhPage, 'cts' | 'ctsFlag'> & { rspCd?: string }): boolean {
  if (!page.cts) return false;
  const flag = (page.ctsFlag ?? '').toUpperCase();
  if (flag === 'N') return false;
  if (flag === 'Y') return true;
  return CONTINUE_CODES.has(page.rspCd ?? '');
}

/** 연속조회를 끝까지 돈다. 같은 `cts`가 다시 오면 즉시 끝낸다(끝 2~3자만 바뀌는 경우가 있어 전체 문자열 비교). */
export async function nhPostAll(path: string, input: Record<string, string>, base: string = BASE_URL): Promise<NhBody[]> {
  const pages: NhBody[] = [];
  let cont: { cts: string; ctsFlag: string | null } | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await nhPost(path, input, cont, base);
    pages.push(page.body);
    if (!hasNextPage({ ...page, rspCd: page.body.rsp_cd })) break;
    if (cont && page.cts === cont.cts) break;
    cont = { cts: page.cts!, ctsFlag: page.ctsFlag };
  }
  return pages;
}

/** `Output_N`을 배열로 — 명세상 블록이 객체(집계)일 수도 배열(목록)일 수도 있고, 0건이면 아예 안 온다. */
export function rowsOf(body: NhBody, key: 'Output_0' | 'Output_1'): Record<string, unknown>[] {
  const v = body[key];
  if (Array.isArray(v)) return v.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  if (v && typeof v === 'object') return [v as Record<string, unknown>];
  return [];
}

const compact = (date: string) => date.replace(/-/g, '');

// ── 계좌 ───────────────────────────────────────────────────────────────────────
export interface NhAccount {
  accountNo: string;
  /** 01 운영(일반) · 02 운영(주문대리인) · 03 모의투자. */
  type: string;
}

export const isPaperType = (type: string) => type === '03';

/** 계좌 목록(`/n2/acctinfo`) — 앱키에 연결된 실전(01 일반·02 주문대리인)과 모의투자(03) 계좌가 섞여 온다.
 *  기본은 실전만. `includePaper`면 모의투자도(보유·매매 화면의 계좌 선택용). 알 수 없는 구분은 버린다. */
export async function fetchNhAccounts(opts: FetchOpts = {}, includePaper = false): Promise<NhAccount[]> {
  const all = await withCache(
    'nh:accounts',
    10 * 60_000,
    async () => {
      const { body } = await nhPost('/n2/acctinfo', {});
      return rowsOf(body, 'Output_0')
        .map((r) => ({ accountNo: String(r.acct_no ?? '').trim(), type: String(r.acct_type ?? '').trim() }))
        .filter((a) => a.accountNo && ['01', '02', '03'].includes(a.type));
    },
    opts
  );
  return includePaper ? all : all.filter((a) => !isPaperType(a.type));
}

/** 이 계좌를 조회할 도메인 — 모의투자 계좌면 moapi. 목록에 없는 계좌(키를 바꿨거나 잘못된 id)는 운영으로 보낸다. */
async function baseFor(accountNo: string): Promise<string> {
  const accounts = await fetchNhAccounts({}, true);
  return accounts.some((a) => a.accountNo === accountNo && isPaperType(a.type)) ? MOCK_BASE_URL : BASE_URL;
}

export async function isNhPaperAccount(accountNo: string): Promise<boolean> {
  return (await baseFor(accountNo)) === MOCK_BASE_URL;
}

// ── 잔고 ───────────────────────────────────────────────────────────────────────
/** 국내주식 잔고(`/krstock/inquiry/v1/balance`). 명세: 순자산·총평가 등 요약은 **잔고를 끝까지 조회한 뒤에** 채워진다
 *  — 그래서 연속조회를 다 돌고 마지막 페이지의 `Output_0`을 요약으로 쓴다. `aly_qut_cd`(정규장/전체장)는 2026-09
 *  명세부터 필수다. 시장은 통합시세(UNT), 시간대는 정규장(1)으로 — SDK 기본값과 같다. */
export function fetchNhDomesticBalance(accountNo: string, opts: FetchOpts = {}) {
  return withCache(
    `nh:balance:${accountNo}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const pages = await nhPostAll('/krstock/inquiry/v1/balance', {
        act_no: accountNo,
        bnc_bse_cd: '5', // 주식잔고평가(현재가기준)
        ltg_aot_dit_cd: '9', // 전체(상장폐지 포함)
        aet_bse: '2', // 총자산
        qut_dit_cd: 'UNT',
        aly_qut_cd: '1',
      }, await baseFor(accountNo));
      const summary = [...pages].reverse().map((p) => rowsOf(p, 'Output_0')[0]).find(Boolean) ?? null;
      if (!summary) {
        const last = pages[pages.length - 1];
        throw new NhApiError(`NH투자증권 잔고 응답에 요약이 없습니다: ${last?.rsp_msg ?? ''}`, 200, JSON.stringify(last ?? {}));
      }
      return { summary, items: pages.flatMap((p) => rowsOf(p, 'Output_1')) };
    },
    opts
  );
}

/** 해외주식 잔고(`/gbstock/inquiry/v1/balance`) — **미국(200)·USD만**. 이 앱은 달러 외 통화를 다루지 않는다
 *  (KIS 해외와 같은 범위). 비용 미포함(0)으로 매입금액을 받는다. */
export function fetchNhOverseasBalance(accountNo: string, opts: FetchOpts = {}) {
  return withCache(
    `nh:overseas-balance:${accountNo}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const pages = await nhPostAll('/gbstock/inquiry/v1/balance', {
        act_no: accountNo,
        qut_iqr_dit_cd: '9',
        fc_sec_trd_nat_cd: '200',
        cur_cd: 'USD',
        xns_dit_cd: '0',
      }, await baseFor(accountNo));
      const summary = [...pages].reverse().map((p) => rowsOf(p, 'Output_0')[0]).find(Boolean) ?? null;
      return { summary, items: pages.flatMap((p) => rowsOf(p, 'Output_1')) };
    },
    opts
  );
}

// ── 거래내역 ───────────────────────────────────────────────────────────────────
/** 종합거래내역(`/common/inquiry/v1/totalTransaction`, HTS 8203). `kind`: 01 입출금 · 03 매매.
 *  국내 매매내역은 `dailyOrderExecution`이 아니라 이걸 쓴다 — 그쪽은 주문일자 **하루씩만** 조회돼 기간을 받으려면
 *  날짜마다 호출해야 한다(초당 4건으로 1년이면 1분 넘게 걸림). */
export function fetchNhTotalTransactions(
  accountNo: string,
  from: string,
  to: string,
  kind: '01' | '03',
  opts: FetchOpts = {}
): Promise<Record<string, unknown>[]> {
  return withCache(
    `nh:total-txn:${accountNo}:${kind}:${from}:${to}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const pages = await nhPostAll('/common/inquiry/v1/totalTransaction', {
        iqr_tp_cd: '1', // 거래일자순
        iqr_rge_cd: '1', // CMA·발행어음·MMW 미포함
        act_no: accountNo,
        iqr_sta_dt: compact(from),
        iqr_end_dt: compact(to),
        iem_llf_cd: '00', // 전체 — 국내 주식/ETF는 01이지만 ETF 분배금 적요가 어느 대분류로 오는지 몰라 전체로 받는다
        act_trd_dtl_cd: kind,
      }, await baseFor(accountNo));
      return pages.flatMap((p) => rowsOf(p, 'Output_0'));
    },
    opts
  );
}

/** 해외주식 일별거래내역(`/gbstock/inquiry/v1/dailyTransaction`). `kind`: 01 입금 · 05 매수 · 06 매도. 외화주식만. */
export function fetchNhOverseasTransactions(
  accountNo: string,
  from: string,
  to: string,
  kind: '01' | '05' | '06',
  opts: FetchOpts = {}
): Promise<Record<string, unknown>[]> {
  return withCache(
    `nh:ovrs-txn:${accountNo}:${kind}:${from}:${to}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const pages = await nhPostAll('/gbstock/inquiry/v1/dailyTransaction', {
        act_no: accountNo,
        iqr_sta_dt: compact(from),
        iqr_end_dt: compact(to),
        act_trd_cfc_cd: kind,
        iem_mlf_cd: '00001',
        iem_cd: '',
      }, await baseFor(accountNo));
      return pages.flatMap((p) => rowsOf(p, 'Output_0'));
    },
    opts
  );
}

/** 입출금내역(`/common/inquiry/v1/depositWithdrawal`, HTS 8207) — 전체(01). 입금 기준 투자원금 카드용. */
export function fetchNhDepositWithdrawals(accountNo: string, from: string, to: string): Promise<Record<string, unknown>[]> {
  return withCache(`nh:dw:${accountNo}:${from}:${to}`, 3600_000, async () => {
    const pages = await nhPostAll('/common/inquiry/v1/depositWithdrawal', {
      iqr_tp_cd: '1',
      act_no: accountNo,
      iqr_sta_dt: compact(from),
      iqr_end_dt: compact(to),
      act_trd_dtl_cd: '01',
    }, await baseFor(accountNo));
    return pages.flatMap((p) => rowsOf(p, 'Output_0'));
  });
}

// ── 공식 실현손익 ──────────────────────────────────────────────────────────────
/** 국내 종목별실현손익현황(`/krstock/inquiry/v1/tradingPnl`, HTS 8229) — 기간 합계를 **종목별 한 줄**로 준다. */
export async function fetchNhDomesticTradingPnl(accountNo: string, from: string, to: string): Promise<Record<string, unknown>[]> {
  const pages = await nhPostAll('/krstock/inquiry/v1/tradingPnl', {
    act_no: accountNo,
    iqr_sta_dt: compact(from),
    iqr_end_dt: compact(to),
  }, await baseFor(accountNo));
  return pages.flatMap((p) => rowsOf(p, 'Output_1'));
}

/** 해외 기간손익(`/gbstock/inquiry/v1/periodPnl`) — **원화 기준(2)**, 미국(200). 주문일·종목 단위 줄. */
export async function fetchNhOverseasPeriodPnl(accountNo: string, from: string, to: string): Promise<Record<string, unknown>[]> {
  const pages = await nhPostAll('/gbstock/inquiry/v1/periodPnl', {
    act_no: accountNo,
    iqr_dit: '2',
    sta_orr_dt: compact(from),
    end_orr_dt: compact(to),
    iem_cd: '',
    trd_cur_cd: 'USD',
    fc_sec_trd_nat_cd: '200',
  }, await baseFor(accountNo));
  return pages.flatMap((p) => rowsOf(p, 'Output_1'));
}
