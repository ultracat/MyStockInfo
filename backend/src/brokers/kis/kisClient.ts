import { getCredentialFields, hasCredential } from '../../credentials';
import { RateLimiter } from '../rateLimiter';
import { getDataDir } from '../../paths';
import { JsonStore } from '../../jsonStore';
import { DEFAULT_TTL_MS, withCache } from '../responseCache';
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

async function fetchToken(): Promise<string> {
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
  trCont = ''
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

  return kisLimiter.schedule(async () => {
    let token = await getToken();

    for (let attempt = 0; ; attempt++) {
      let res = await doFetch(token);

      if (res.status === 401) {
        token = await getToken(true);
        res = await doFetch(token);
      }

      const text = await res.text();
      if (!res.ok) {
        throw new KisApiError(`한국투자증권 API 호출 실패: ${path}`, res.status, text);
      }

      let json: KisEnvelope;
      try {
        json = JSON.parse(text);
      } catch {
        throw new KisApiError(`한국투자증권 API 응답 파싱 실패: ${path}`, res.status, text);
      }

      if (json.rt_cd !== '0') {
        // 주식잔고조회 doc (KIS's official API spec sheet, "개요" section):
        // this TR draws from two separate rate limits.
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
        if (json.msg_cd === 'EGW00201' || json.msg_cd === 'EGW00215') {
          const backoffMs = 2 ** attempt * 1000 + Math.random() * 250;
          if (json.msg_cd === 'EGW00201') {
            kisLimiter.penalizeUntil(Date.now() + backoffMs);
          }
          if (attempt < 3) {
            await sleep(backoffMs);
            continue;
          }
        }
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
  return withCache('kis:balance', DEFAULT_TTL_MS, fetchKisBalanceUncached, opts);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmd(s: string): Date {
  return new Date(`${s}T00:00:00`);
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
      trCont
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
