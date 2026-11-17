// DB증권(구 DB금융투자) REST Open API — 조회 TR만(주문 안 함). 2026-11-17 추가.
// 정본: 포털 TR 필드 명세 JSON(openapi.dbsec.co.kr/api/apis/guide/tr/property/{trId}, 로그인 불필요 — 공개 API로 문서화된 것은 아님)
// + 공식 GitHub github.com/DBsecurities/dbsec-open-api(examples/·docs/errors_and_rate_limits.md, 커밋 564b5100).
// ⚠ 포털의 응답 예시(resExample)엔 실제 고객 데이터로 보이는 값이 있어 저장소에 두지 않는다(명세 감시는 구조만, 테스트는 지어낸 값).
// ⚠⚠ **실제 키로 한 번도 호출하지 않았다**(개발자에게 DB 계좌가 없음). 키를 받으면 `npm run check:db -- --record`부터.
//
// 규약(공식):
// - 전부 POST `https://openapi.dbsec.co.kr:8443` + 경로. 헤더 `authorization: Bearer`, `cont_yn`(Y/N), `cont_key`(최대 70자).
//   요청 `{"In": {...}}`(입력 없는 TR도 `{"In": {}}`), 응답 `Out`·`Out1`… + `rsp_cd`/`rsp_msg`. 운영·모의가 같은 도메인(앱키로 구분).
// - **앱키 = 계좌 하나**(계좌 단위 신청, 최대 3계좌) — 요청에 계좌번호가 없고 계좌 목록 TR도 없다. 계좌번호를 알려주는 응답도 거래가
//   있을 때의 거래내역 줄뿐이라, KB처럼 **사용자가 설정에 적은 계좌번호**를 그 계좌 id로 쓴다(credentialFields.ts).
// - 성공: HTTP 200 + `rsp_cd == "00000"`. "조회내역이 없습니다"(2679)는 0건으로 본다. 게이트웨이 오류는 HTTP 4xx/5xx의 IGW 코드 —
//   IGW00121·IGW00123 토큰 무효/만료(재발급 1회), IGW00201 호출 건수 초과(쉬었다 재시도). 같은 코드가 여러 문구로 쓰여 `rsp_msg`를 같이 싣는다.
// - 토큰: 24시간, **발급 1분에 1건**, 유효기간 안의 재발급은 같은 토큰(공식) — xingFamily의 파일 캐시.
// - 연속조회: 응답 헤더 `cont_yn=Y`면 받은 `cont_key`로 다시(끝나면 N·""). 속도: 앱 10TPS(공지, SDK는 20 — 낮은 쪽) + TR별 TPS.
import { RateLimiter } from '../rateLimiter';
import { redactText } from '../../logRedact';
import { getCredentialFields, hasCredential } from '../../credentials';
import { PORTFOLIO_TTL_MS, withCache } from '../responseCache';
import { noteResponse } from '../responseShape';
import type { FetchOpts } from '../types';
import { compactDate, createXingTokenCache, xStr, yearWindows } from '../xingFamily';
import type { DbRequests, DbResponses } from './dbSpec.gen';

const BASE_URL = 'https://openapi.dbsec.co.kr:8443';
const MAX_PAGES = 200;

/** 이 앱이 부르는 TR — 경로·TR별 초당 건수는 포털 명세(watch.json db.trs) 그대로. */
const TRS = {
  CSPAQ03420: { path: '/api/v1/trading/kr-stock/inquiry/balance', tps: 2 },
  CDPCQ00100: { path: '/api/v1/trading/kr-stock/inquiry/acnt-deposit', tps: 1 },
  CDPCQ04700: { path: '/api/v1/trading/kr-stock/inquiry/trading-history', tps: 2 },
  CAZCQ00400: { path: '/api/v1/trading/overseas-stock/inquiry/balance-margin', tps: 3 },
  CAZCQ00200: { path: '/api/v1/trading/overseas-stock/inquiry/trading-history', tps: 2 },
  CAZCQ01600: { path: '/api/v1/trading/overseas-stock/inquiry/trade-history', tps: 2 },
} as const;
export type DbTr = keyof typeof TRS & keyof DbResponses;

const appLimiter = new RateLimiter({ tps: 10 }, 'DB');
const limiters = new Map<string, RateLimiter>();
const limiterFor = (tr: string, tps: number) => {
  if (!limiters.has(tr)) limiters.set(tr, new RateLimiter({ tps }, `DB-${tr}`));
  return limiters.get(tr)!;
};
// 발급은 1분에 1건(공식)이지만 토큰을 24시간 파일에 두고 동시 발급을 하나로 합쳐 실제로는 하루 한 번이다 — 리미터는 일반 간격만.
const tokens = createXingTokenCache({ broker: 'db', label: 'DB증권', tokenUrl: `${BASE_URL}/oauth2/token`, limiter: new RateLimiter({ tps: 1 }, 'DB-token') });

export class DbApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = 'DbApiError';
  }
}

export function isDbConfigured(): boolean {
  return hasCredential('db');
}

/** 이 키가 묶인 계좌 — API가 알려주지 않아 사용자가 설정에 적은 값(KB와 같은 방식). 비어 있으면 'DB' 하나로. */
export async function getDbAccountId(): Promise<string> {
  const c = await getCredentialFields('db');
  return xStr(c?.accountNumber) || 'DB';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NO_DATA = new Set(['2679']);

export interface DbPage<T extends DbTr> {
  body: DbResponses[T];
  contYn: string;
  contKey: string;
}

export async function dbPost<T extends DbTr>(tr: T, input: DbRequests[T]['In'], cont?: { key: string }): Promise<DbPage<T>> {
  const { path, tps } = TRS[tr];
  return limiterFor(tr, tps).schedule(() =>
    appLimiter.schedule(async () => {
      let stale: string | undefined;
      for (let attempt = 0; ; attempt++) {
        const token = await tokens.getToken(stale);
        let res: Response;
        let text: string;
        try {
          res = await fetch(`${BASE_URL}${path}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json; charset=utf-8',
              authorization: `Bearer ${token}`,
              cont_yn: cont ? 'Y' : 'N',
              cont_key: cont?.key ?? '',
            },
            body: JSON.stringify({ In: input }),
            signal: AbortSignal.timeout(15_000),
          });
          text = await res.text();
        } catch (err) {
          throw new DbApiError(`DB증권 API 연결 오류: ${tr} (${(err as Error).message})`, 0, '');
        }
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(text);
        } catch {
          if (res.ok) throw new DbApiError(`DB증권 API 응답 해석 실패: ${tr}`, res.status, text);
        }
        const code = xStr(body.rsp_cd);
        if (stale === undefined && (res.status === 401 || /IGW0012[13]/.test(`${code} ${text}`))) {
          stale = token;
          continue;
        }
        if ((res.status === 429 || /IGW00201/.test(`${code} ${text}`)) && attempt < 3) {
          await sleep(2 ** attempt * 1000 + Math.random() * 250);
          continue;
        }
        if (res.ok && NO_DATA.has(code)) return { body: {} as DbResponses[T], contYn: 'N', contKey: '' };
        if (!res.ok || code !== '00000') {
          const msg = redactText(xStr(body.rsp_msg), 120);
          throw new DbApiError(`DB증권 API 오류 ${tr}${code ? ` (${code})` : ` (HTTP ${res.status})`}${msg ? `: ${msg}` : ''}`, res.ok ? 502 : res.status, text);
        }
        noteResponse('db', tr, body); // 응답 모양 관찰(값 없이) — db-live.json과 비교·--record 기록
        return { body: body as DbResponses[T], contYn: xStr(res.headers.get('cont_yn')), contKey: xStr(res.headers.get('cont_key')) };
      }
    })
  );
}

/** 연속조회 — `cont_yn=Y`인 동안 `cont_key`로. 같은 키로 되돌아오면 멈추고, 상한에서는 던진다(잘린 목록으로 저장하지 않게). */
export async function dbPostAll<T extends DbTr>(tr: T, input: DbRequests[T]['In']): Promise<DbResponses[T][]> {
  const pages: DbResponses[T][] = [];
  const seen = new Set<string>();
  let cont: { key: string } | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await dbPost(tr, input, cont);
    pages.push(page.body);
    if (page.contYn.toUpperCase() !== 'Y' || !page.contKey || seen.has(page.contKey)) return pages;
    seen.add(page.contKey);
    cont = { key: page.contKey };
  }
  throw new DbApiError(`DB증권 연속조회가 ${MAX_PAGES}페이지를 넘어 끝까지 받지 못했습니다: ${tr}`, 502, '');
}

/** 블록 → 줄 배열(명세는 객체라고 해도 공식 예시가 배열인 블록이 있다 — CDPCQ04700 Out1). */
export function rowsOf<R>(v: R | readonly R[] | null | undefined): R[] {
  if (Array.isArray(v)) return (v as R[]).filter((r) => !!r && typeof r === 'object');
  return v && typeof v === 'object' ? [v as R] : [];
}

// ── 잔고·예수금 ────────────────────────────────────────────────────────────────
/** 국내 잔고(CSPAQ03420, 전체 QryTpCode0 0) — Out 합계 + Out1 종목(연속조회). ⚠ 명세에 평균단가 필드가 없다 — 매입금액 ÷ 수량. */
export function fetchDbDomesticBalance(opts: FetchOpts = {}) {
  return withCache(
    'db:balance',
    PORTFOLIO_TTL_MS,
    async () => {
      const pages = await dbPostAll('CSPAQ03420', { QryTpCode0: '0' });
      return { summary: rowsOf(pages[0]?.Out)[0] ?? null, items: pages.flatMap((p) => rowsOf(p.Out1)) };
    },
    opts
  );
}

/** 국내 예수금(CDPCQ00100) — Out1 `DpsBalAmt`(예수금잔고). */
export function fetchDbDeposit(opts: FetchOpts = {}) {
  return withCache('db:deposit', PORTFOLIO_TTL_MS, async () => rowsOf((await dbPost('CDPCQ00100', {})).body.Out1)[0] ?? null, opts);
}

/** 해외 잔고·증거금(CAZCQ00400, 주식잔고상세 2·외화 2·제비용 포함 2) — Out1 통화별(외화예수금 `FcurrDps`), Out2 종목. */
export function fetchDbOverseasBalance(opts: FetchOpts = {}) {
  return withCache(
    'db:overseas-balance',
    PORTFOLIO_TTL_MS,
    async () => {
      const pages = await dbPostAll('CAZCQ00400', { TrxTpCode: '2', CmsnTpCode: '2', WonFcurrTpCode: '2', DpntBalTpCode: '0' });
      return { currencies: pages.flatMap((p) => rowsOf(p.Out1)), items: pages.flatMap((p) => rowsOf(p.Out2)) };
    },
    opts
  );
}

// ── 거래내역 ───────────────────────────────────────────────────────────────────
/** 국내 계좌 거래내역(CDPCQ04700) — `qryTp`: 1 입출금 · 2 입출고 · 3 매매. 조회 기간 최대 12개월(공식 예제) → 1년씩 나눠 부른다. */
export function fetchDbLedger(from: string, to: string, qryTp: '1' | '2' | '3', opts: FetchOpts = {}) {
  return withCache(
    `db:ledger:${qryTp}:${from}:${to}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const rows = [];
      for (const [a, b] of yearWindows(from, to)) {
        const pages = await dbPostAll('CDPCQ04700', { QryTp: qryTp, QrySrtDt: compactDate(a), QryEndDt: compactDate(b), SrtNo: 0, IsuNo: '' });
        for (const p of pages) rows.push(...rowsOf(p.Out1));
      }
      return rows;
    },
    opts
  );
}

/** 해외 매매내역(CAZCQ00200, 건별 1·외화 2·매매일 기준 1) — 기간 상한이 명세에 없어 1년씩. */
export function fetchDbOverseasTrades(from: string, to: string, opts: FetchOpts = {}) {
  return withCache(
    `db:ovrs-trades:${from}:${to}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const rows = [];
      for (const [a, b] of yearWindows(from, to)) {
        const pages = await dbPostAll('CAZCQ00200', {
          QrySrtDt: compactDate(a), QryEndDt: compactDate(b), AstkIsuNo: '', AstkBnsTpCode: '0', StnlnTpCode: '1',
          QryTpCode: '1', WonFcurrTpCode: '2', BaseDdTpCode: '1', DpntBalTpCode: '0',
        });
        for (const p of pages) rows.push(...rowsOf(p.Out));
      }
      return rows;
    },
    opts
  );
}

/** 해외 거래내역(CAZCQ01600, 입출금 1) — 해외 배당이 "배당금입금(외화)"(세전)·"배당세출금(외화)"(원천세) 두 줄로 온다(공식 예시). */
export function fetchDbOverseasLedger(from: string, to: string, opts: FetchOpts = {}) {
  return withCache(
    `db:ovrs-ledger:${from}:${to}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const rows = [];
      for (const [a, b] of yearWindows(from, to)) {
        const pages = await dbPostAll('CAZCQ01600', { QrySrtDt: compactDate(a), QryEndDt: compactDate(b), StnlnTpCode: '1', AstkIsuNo: '', QryTpCode: '1', DpntBalTpCode: '0' });
        for (const p of pages) rows.push(...rowsOf(p.Out));
      }
      return rows;
    },
    opts
  );
}
