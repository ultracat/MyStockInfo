import { getCredentialFields, hasCredential } from '../../credentials';
import { RateLimiter } from '../rateLimiter';
import { getDataDir } from '../../paths';
import { JsonStore } from '../../jsonStore';
import { DEFAULT_TTL_MS, PORTFOLIO_TTL_MS, withCache } from '../responseCache';
import type { FetchOpts } from '../types';

// koreainvestment/open-trading-api (examples_user/kis_auth.py, checked
// 2026-08-12): real-trading base URL. Paper trading
// (https://openapivts.koreainvestment.com:29443) isn't wired up here — this
// app is for viewing real holdings, not testing.
const BASE_URL = 'https://openapi.koreainvestment.com:9443';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// KIS's repo README doesn't publish an exact REST TPS figure in prose (only
// that paper-trading accounts are more restricted — "모의투자 계좌는 REST API
// 호출 제한이 낮습니다"), but the official example client
// (examples_user/kis_auth.py's smart_sleep) hardcodes the real numbers it
// paces itself to: 0.05s between calls on a real-trading account (20/s),
// 0.5s on paper trading (2/s). We stay well under that real-trading figure
// (4/s) since this is a background desktop app, not a latency-sensitive
// trading client, and because account-tier limits can be stricter than the
// example's default. EGW00201 (in the response body — see kisGet below) is
// the live signal that our effective limit is even tighter than that, and
// pushes future calls' pacing out via `penalizeUntil`, not just retries the
// one call that failed.
const kisLimiter = new RateLimiter({ tps: 4 }, 'KIS');

// 주식일별주문체결조회(inquire-daily-ccld)는 실측 결과 inquire-balance와 같은 4건/초
// 페이싱으로도 EGW00201(초당 거래건수 초과)에 훨씬 잘 걸린다(위 kisLimiter 주석,
// backend/CLAUDE.md 참고) — 토큰/잔고조회와 한 페이싱을 공유하면 이 TR 하나 때문에
// 계정 전체가 더 자주 걸리므로, 토스 클라이언트가 TR/엔드포인트 그룹별로 별도
// RateLimiter를 두는 것(rateLimitGroups.ts)과 같은 방식으로 이 TR 전용 인스턴스를
// 분리해 더 보수적으로(1건/초) 페이싱한다. 페이지네이션(최대 50페이지) + "3개월
// 이내/이전" TR 분할로 짧은 시간에 여러 번 연속 호출되는 TR이라 재시도 여유도 더
// 필요해서, kisGet 호출 시 maxAttempts도 이 TR만 늘려서 넘긴다.
const kisDailyCcldLimiter = new RateLimiter({ tps: 1 }, 'KIS-DailyCcld');

interface KisTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  access_token_token_expired?: string; // "YYYY-MM-DD HH:mm:ss"
}

interface KisEnvelope {
  rt_cd: string;
  msg_cd: string;
  msg1: string;
  // 대부분의 TR(잔고조회/일별체결조회)은 output1/output2를 쓰지만, 단일
  // 결과셋만 돌려주는 TR(주식현재가 시세 등)은 원장 JSON 키가 그냥 `output`
  // 하나다(공식 예제 kis_auth.py의 APIResp가 응답 JSON 키를 그대로
  // namedtuple 필드로 쓰는 걸 확인 — TR마다 실제 키가 다름, checked 2026-08-17).
  output?: unknown;
  output1?: unknown;
  output2?: unknown;
  ctx_area_fk100?: string;
  ctx_area_nk100?: string;
}

export interface KisHoldingItem {
  pdno: string;
  prdt_name: string;
  hldg_qty: string;
  ord_psbl_qty: string;
  pchs_avg_pric: string;
  pchs_amt: string;
  prpr: string;
  evlu_amt: string;
  evlu_pfls_amt: string;
  evlu_pfls_rt: string;
  [key: string]: unknown;
}

export interface KisAccountSummary {
  pchs_amt_smtl_amt: string;
  evlu_amt_smtl_amt: string;
  evlu_pfls_smtl_amt: string;
  scts_evlu_amt: string;
  dnca_tot_amt: string;
  tot_evlu_amt: string;
  [key: string]: unknown;
}

/** 주식일별주문체결조회 output1 row — column names per the official example
 *  script's COLUMN_MAPPING (examples_llm/domestic_stock/inquire_daily_ccld/
 *  chk_inquire_daily_ccld.py, checked 2026-08-14). */
export interface KisDailyCcldItem {
  ord_dt: string; // 주문일자 YYYYMMDD
  odno: string; // 주문번호
  pdno: string; // 상품번호(종목코드)
  prdt_name: string; // 상품명(종목명)
  sll_buy_dvsn_cd: string; // 매도매수구분코드 (01: 매도, 02: 매수)
  sll_buy_dvsn_cd_name: string; // "매도" / "매수"
  ord_qty: string; // 주문수량
  ord_unpr: string; // 주문단가
  tot_ccld_qty: string; // 총체결수량
  avg_prvs: string; // 평균가(체결평균단가)
  tot_ccld_amt: string; // 총체결금액
  [key: string]: unknown;
}

export class KisApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = 'KisApiError';
  }
}

function requireCredentials() {
  const creds = getCredentialFields('kis');
  if (!creds) {
    throw new Error('한국투자증권 API 키가 설정되지 않았습니다. 설정 화면에서 앱키/앱시크릿/계좌번호를 입력해주세요.');
  }
  return creds;
}

interface StoredKisToken {
  accessToken: string;
  expiresAt: number;
}

// KIS caps token issuance at 1 per minute (EGW00133) and tokens are valid up
// to ~24h, so — unlike a plain in-memory cache — this must survive a backend
// restart: this project's dev workflow requires rebuilding + restarting
// Electron on every backend change (see CLAUDE.md), which previously reset
// an in-memory-only cache and immediately re-hit the 1/min limit on the next
// holdings load.
const tokenStore = () => new JsonStore<StoredKisToken | null>('kis-token.json', getDataDir(), null);
let cachedToken: StoredKisToken | null = null;

function loadCachedToken(): StoredKisToken | null {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken;
  const persisted = tokenStore().read();
  if (persisted && persisted.expiresAt > Date.now()) {
    cachedToken = persisted;
    return cachedToken;
  }
  return null;
}

async function fetchTokenUncached(): Promise<string> {
  const creds = requireCredentials();

  const res = await kisLimiter.schedule(() =>
    fetch(`${BASE_URL}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: creds.appKey,
        appsecret: creds.appSecret,
      }),
    })
  );

  const text = await res.text();
  if (!res.ok) {
    throw new KisApiError('한국투자증권 토큰 발급 실패', res.status, text);
  }

  const data = JSON.parse(text) as KisTokenResponse;
  const expiresInSec = data.expires_in ?? 86400;
  // 60s safety buffer before expiry.
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + (expiresInSec - 60) * 1000 };
  tokenStore().write(cachedToken);
  return cachedToken.accessToken;
}

// 캐시된 토큰이 만료/부재 상태일 때 동시에 들어온 호출들이 각자 fetchTokenUncached를
// 부르면 KIS 토큰을 중복 발급하게 된다 — 문서화된 "1일 1회 발급 제한"(EGW00133,
// kis-token.json 주석 참고)에 걸리면 그날 하루 종일 API가 막힌다. in-flight
// 프로미스를 공유해서 동시 요청이 실제 발급 요청 하나만 타게 한다.
let inFlightFetch: Promise<string> | null = null;

function fetchToken(): Promise<string> {
  if (!inFlightFetch) {
    inFlightFetch = fetchTokenUncached().finally(() => {
      inFlightFetch = null;
    });
  }
  return inFlightFetch;
}

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const token = loadCachedToken();
    if (token) return token.accessToken;
  }
  return fetchToken();
}

/**
 * KIS reports application-level errors inside a 200 response body
 * (`rt_cd`/`msg_cd`/`msg1`), not via HTTP status — confirmed against
 * examples_user/kis_auth.py's APIResp wrapper. `EGW00201` is the
 * documented "초당 거래건수 초과" (per-second call count exceeded) code, so
 * that's what triggers our backoff-and-retry here (1s, 2s, 4s + jitter),
 * separate from the Toss client's HTTP-429/header-based approach.
 */
/**
 * `trCont` is KIS's continuation flag for paginated (연속조회) TRs — pass ''
 * on the first call and 'N' on follow-ups, echoing back the `ctx_area_fk100`/
 * `ctx_area_nk100` values the previous page returned in its body (per
 * examples_user/kis_auth.py's `_url_fetch`/`smart_sleep` pattern). The
 * response's own `tr_cont` header (returned here) is 'M' or 'F' when another
 * page is available. inquire-balance (this file's only other caller) never
 * pages, so it just omits the param and gets the default ''.
 */
async function kisGet(
  path: string,
  trId: string,
  params: Record<string, string>,
  trCont = '',
  limiter: RateLimiter = kisLimiter,
  maxRetries = 3
): Promise<KisEnvelope & { trCont: string }> {
  const creds = requireCredentials();
  const query = new URLSearchParams(params);

  const doFetch = async (token: string) =>
    fetch(`${BASE_URL}${path}?${query}`, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'text/plain',
        authorization: `Bearer ${token}`,
        appkey: creds.appKey,
        appsecret: creds.appSecret,
        tr_id: trId,
        tr_cont: trCont,
        custtype: 'P',
      },
    });

  return limiter.schedule(async () => {
    let token = await getToken();

    for (let attempt = 0; ; attempt++) {
      let res = await doFetch(token);

      if (res.status === 401) {
        token = await getToken(true);
        res = await doFetch(token);
      }

      const text = await res.text();

      let json: KisEnvelope | null = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      // 문서상 EGW00201/EGW00215는 "200 응답 바디 안의 rt_cd/msg_cd"로 온다고
      // 되어 있지만, 실사용 중 부하가 몰리면 같은 msg_cd가 담긴 바디를 HTTP
      // 500으로도 보낸다(실측: `inquire-daily-ccld`에 짧은 간격으로 여러 요청을
      // 동시에 보냈더니 res.status===500 + 이 msg_cd 조합이 실제로 나왔다).
      // 그래서 이 판단은 res.ok 여부보다 먼저 한다 — 그래야 500으로 온
      // rate-limit 에러도 재시도/penalizeUntil을 타고, res.ok 체크가 먼저면 이
      // 분기에 닿기도 전에 곧장 throw돼서 재시도 로직 자체가 무력화된다(실제로
      // 그렇게 프론트까지 에러가 새어나간 걸 확인하고 고쳤다).
      //  - EGW00201 ("초당 거래건수를 초과하였습니다", no "원장" mention):
      //    OUR OWN per-account quota — slow down every future call through
      //    this limiter, not just retry this one, since our steady-state
      //    pacing (see kisLimiter above) is apparently still faster than
      //    what this account/tier actually allows.
      //  - EGW00215 ("원장에서 허용 가능한 초당 거래건수를 초과하였습니다"):
      //    a ledger-wide 120 TPS cap shared across *all* KIS customers on
      //    this specific (heavy) TR, unrelated to our own pacing — the doc
      //    explicitly says to just retry, so we do, without penalizing our
      //    own limiter for another customer's traffic.
      if (json && (json.msg_cd === 'EGW00201' || json.msg_cd === 'EGW00215')) {
        const backoffMs = 2 ** attempt * 1000 + Math.random() * 250;
        if (json.msg_cd === 'EGW00201') {
          limiter.penalizeUntil(Date.now() + backoffMs);
        }
        if (attempt < maxRetries) {
          await sleep(backoffMs);
          continue;
        }
        throw new KisApiError(`한국투자증권 API 오류 (${json.msg_cd}): ${json.msg1}`, res.status, text);
      }

      if (!res.ok) {
        throw new KisApiError(`한국투자증권 API 호출 실패: ${path}`, res.status, text);
      }
      if (!json) {
        throw new KisApiError(`한국투자증권 API 응답 파싱 실패: ${path}`, res.status, text);
      }
      if (json.rt_cd !== '0') {
        throw new KisApiError(`한국투자증권 API 오류 (${json.msg_cd}): ${json.msg1}`, res.status, text);
      }

      return { ...json, trCont: res.headers.get('tr_cont') ?? '' };
    }
  });
}

export function isKisConfigured(): boolean {
  // Existence check only — see the matching comment in tossClient.ts.
  return hasCredential('kis');
}

async function fetchKisBalanceUncached(): Promise<{ items: KisHoldingItem[]; summary: KisAccountSummary }> {
  const creds = requireCredentials();

  const data = await kisGet('/uapi/domestic-stock/v1/trading/inquire-balance', 'TTTC8434R', {
    CANO: creds.accountNumber,
    ACNT_PRDT_CD: creds.accountProductCode,
    AFHR_FLPR_YN: 'N',
    OFL_YN: '',
    INQR_DVSN: '01',
    UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N',
    FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN: '00',
    CTX_AREA_FK100: '',
    CTX_AREA_NK100: '',
  });

  const items = Array.isArray(data.output1) ? (data.output1 as KisHoldingItem[]) : [];
  const summaryRaw = data.output2;
  const summary = Array.isArray(summaryRaw) ? summaryRaw[0] : summaryRaw;

  if (!summary || typeof summary !== 'object') {
    console.error('[kis] Unexpected inquire-balance response shape:', JSON.stringify(data));
    throw new Error(
      '한국투자증권 잔고 조회 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
    );
  }

  return { items, summary: summary as KisAccountSummary };
}

export async function fetchKisBalance(
  opts: FetchOpts = {}
): Promise<{ items: KisHoldingItem[]; summary: KisAccountSummary }> {
  // Concurrent callers for the same key (e.g. React StrictMode's dev-mode
  // double-invoked effect firing two real requests a moment apart) are
  // coalesced onto one in-flight call by withCache itself — see
  // brokers/responseCache.ts.
  return withCache('kis:balance', PORTFOLIO_TTL_MS, fetchKisBalanceUncached, opts);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmd(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

/** 기간별계좌권리현황조회(`CTRGA011R`, `GET /uapi/domestic-stock/v1/trading/period-rights`, 공식 예제
 *  `examples_llm/domestic_stock/period_rights/period_rights.py` 확인 2026-11-09) 한 행 — 배당 동기화에 쓰는
 *  필드만. 금액은 문자열(원). `rght_type_cd`는 실측상 `03`=주식 배당, `32`=ETF 분배금(코드표는 문서에 없음).
 *  `last_alct_amt`=최종배정금액(세전), `tax_amt`=세금, `cash_dfrm_dt`=현금지급일(미래면 지급 예정). */
export interface KisPeriodRight {
  rght_type_cd: string;
  bass_dt: string;
  pdno: string;
  shtn_pdno: string;
  prdt_name: string;
  last_alct_amt: string;
  tax_amt: string;
  cash_dfrm_dt: string;
}

/** 이 앱이 쓰는 KIS 계좌 id(`CANO-상품코드`) — kisAdapter의 계좌 목록과 같은 형식. */
export function getKisAccountId(): string {
  const creds = requireCredentials();
  return `${creds.accountNumber}-${creds.accountProductCode}`;
}

/** 계좌의 권리 내역 전체(기본 2000-01-01부터) — 25건씩 연속조회(`tr_cont` M/F)로 끝까지 받는다.
 *  긴 기간을 한 번에 조회해도 된다(실측 2026-11-09). 매매내역 TR과 같은 1tps 리미터를 쓴다. */
export async function fetchKisPeriodRights(from = '2000-01-01', to = '2099-12-31'): Promise<KisPeriodRight[]> {
  const creds = requireCredentials();
  const items: KisPeriodRight[] = [];
  let fk100 = '';
  let nk100 = '';
  let trCont = '';
  for (let page = 0; page < 200; page++) {
    const res = await kisGet(
      '/uapi/domestic-stock/v1/trading/period-rights',
      'CTRGA011R',
      {
        INQR_DVSN: '03',
        CANO: creds.accountNumber,
        ACNT_PRDT_CD: creds.accountProductCode,
        INQR_STRT_DT: from.replace(/-/g, ''),
        INQR_END_DT: to.replace(/-/g, ''),
        CUST_RNCNO25: '',
        HMID: '',
        RGHT_TYPE_CD: '',
        PDNO: '',
        PRDT_TYPE_CD: '',
        CTX_AREA_FK100: fk100,
        CTX_AREA_NK100: nk100,
      },
      trCont,
      kisDailyCcldLimiter,
      5
    );
    const out = res.output;
    items.push(...((Array.isArray(out) ? out : out ? [out] : []) as KisPeriodRight[]));
    if (res.trCont !== 'M' && res.trCont !== 'F') break;
    fk100 = String(res.ctx_area_fk100 ?? '');
    nk100 = String(res.ctx_area_nk100 ?? '');
    trCont = 'N';
  }
  return items;
}

/** Fetches every page of one 주식일별주문체결조회 query (single TR/date range), following `ctx_area_fk100`/`nk100` until `tr_cont` stops being 'M'/'F'. */
async function fetchDailyCcldAllPages(
  trId: string,
  base: Record<string, string>
): Promise<KisDailyCcldItem[]> {
  const items: KisDailyCcldItem[] = [];
  let fk100 = '';
  let nk100 = '';
  let trCont = '';

  // Real accounts return up to 100 rows/page per docs — 50 pages is a
  // generous safety cap well beyond a year of realistic personal trading
  // activity, so a stuck continuation cursor can't loop forever.
  for (let page = 0; page < 50; page++) {
    const res = await kisGet(
      '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
      trId,
      { ...base, CTX_AREA_FK100: fk100, CTX_AREA_NK100: nk100 },
      trCont,
      kisDailyCcldLimiter,
      5
    );

    const output1 = Array.isArray(res.output1) ? (res.output1 as KisDailyCcldItem[]) : [];
    items.push(...output1);

    if (res.trCont !== 'M' && res.trCont !== 'F') break;
    fk100 = String(res.ctx_area_fk100 ?? '');
    nk100 = String(res.ctx_area_nk100 ?? '');
    trCont = 'N';
  }

  return items;
}

async function fetchKisTradeHistoryUncached(from: string, to: string): Promise<KisDailyCcldItem[]> {
  const creds = requireCredentials();
  const fromDate = parseYmd(from);
  const toDate = parseYmd(to);
  if (fromDate > toDate) return [];

  const base = {
    CANO: creds.accountNumber,
    ACNT_PRDT_CD: creds.accountProductCode,
    SLL_BUY_DVSN_CD: '00', // 전체
    PDNO: '',
    CCLD_DVSN: '01', // 체결만
    INQR_DVSN: '00', // 역순
    INQR_DVSN_3: '00', // 전체
    ORD_GNO_BRNO: '',
    ODNO: '',
    INQR_DVSN_1: '',
    EXCG_ID_DVSN_CD: 'ALL',
  };

  // 이 TR은 실전계좌 기준으로 "3개월 이내"(TTTC0081R)와 "3개월 이전"(CTSC9215R)이
  // 서로 다른 TR_ID로 나뉘어 있다(examples_llm/domestic_stock/inquire_daily_ccld/
  // inquire_daily_ccld.py, checked 2026-08-14) — 조회기간이 그 경계를 걸치면
  // 두 TR을 각각 필요한 구간만큼만 호출해서 합친다.
  const splitDate = new Date();
  splitDate.setMonth(splitDate.getMonth() - 3);

  const items: KisDailyCcldItem[] = [];

  if (fromDate < splitDate) {
    const beforeEndDate = toDate < splitDate ? toDate : new Date(splitDate.getTime() - 24 * 60 * 60 * 1000);
    if (beforeEndDate >= fromDate) {
      items.push(
        ...(await fetchDailyCcldAllPages('CTSC9215R', {
          ...base,
          INQR_STRT_DT: ymd(fromDate),
          INQR_END_DT: ymd(beforeEndDate),
        }))
      );
    }
  }

  if (toDate >= splitDate) {
    const innerStartDate = fromDate > splitDate ? fromDate : splitDate;
    if (toDate >= innerStartDate) {
      items.push(
        ...(await fetchDailyCcldAllPages('TTTC0081R', {
          ...base,
          INQR_STRT_DT: ymd(innerStartDate),
          INQR_END_DT: ymd(toDate),
        }))
      );
    }
  }

  return items;
}

export async function fetchKisTradeHistory(
  from: string,
  to: string,
  opts: FetchOpts = {}
): Promise<KisDailyCcldItem[]> {
  return withCache(`kis:trades:${from}:${to}`, DEFAULT_TTL_MS, () => fetchKisTradeHistoryUncached(from, to), opts);
}

/**
 * 국내주식 현재가 시세(`inquire-price`, TR `FHKST01010100`, 공식 예제
 * examples_llm/domestic_stock/inquire_price/inquire_price.py 확인, checked
 * 2026-08-17) — `inquire-balance`처럼 계좌 보유종목이 아니라 임의 종목코드의
 * 공개 시세를 조회하는 API라 CANO가 필요 없다. 보유종목 CSV 가져오기에서
 * 토스 미연동일 때의 현재가 대체 조회로 쓴다(`stockNameResolver.ts`의
 * `resolveStockPrices`). **해외주식은 지원 안 함** — KIS의 해외 현재가
 * API(`/uapi/overseas-price/v1/quotations/price`)는 거래소코드(EXCD, 예:
 * NAS/NYS)가 필수인데 이 앱은 그 정보를 안 받고 있어서(CSV에 통화만 있고
 * 거래소는 없음) 임의로 추측해 넣지 않는다 — 국내(KR) 6자리 종목코드만 지원.
 * `output`(단수) 키를 쓰는 TR이라 `output1`이 아니라 `output`을 읽는다(위
 * `KisEnvelope` 주석 참고).
 */
export async function fetchKisDomesticPrice(symbol: string, opts: FetchOpts = {}): Promise<number | null> {
  return withCache(
    `kis:price:${symbol}`,
    DEFAULT_TTL_MS,
    async () => {
      const res = await kisGet('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: symbol,
      });
      const output = res.output;
      if (!output || typeof output !== 'object' || !('stck_prpr' in output)) return null;
      const price = Number((output as { stck_prpr: string }).stck_prpr);
      return Number.isFinite(price) ? price : null;
    },
    opts
  );
}

/**
 * 주식기본조회(`search-stock-info`, TR `CTPF1002R`, 공식 예제
 * examples_llm/domestic_stock/search_stock_info/search_stock_info.py +
 * chk_search_stock_info.py의 COLUMN_MAPPING 확인, checked 2026-08-17) — 종목코드로
 * 종목명(`prdt_name`)을 조회하는 마스터데이터 API(계좌 무관). `inquire-price`의
 * `output`엔 종목명이 없어서(`bstp_kor_isnm`은 업종명이지 종목명이 아님) 이 TR이
 * 따로 필요했다. `stockNameResolver.ts`의 `resolveStockNames`가 토스 미연동/조회
 * 실패 시 대체 조회로 쓴다(토스 → KIS → KB 순서 중 2번째). **국내(KR) 6자리
 * 종목코드만 지원**(`PRDT_TYPE_CD: '300'` = 주식/ETF/ETN/ELW) — 해외 종목은 이
 * TR로 조회 안 함(`fetchKisDomesticPrice`와 같은 이유).
 */
export async function fetchKisStockName(symbol: string): Promise<string | null> {
  const res = await kisGet('/uapi/domestic-stock/v1/quotations/search-stock-info', 'CTPF1002R', {
    PRDT_TYPE_CD: '300',
    PDNO: symbol,
  });
  const output = res.output;
  if (!output || typeof output !== 'object' || !('prdt_name' in output)) return null;
  const name = String((output as { prdt_name: string }).prdt_name).trim();
  return name || null;
}
