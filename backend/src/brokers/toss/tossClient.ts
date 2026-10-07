import { getCredentialFields, hasCredential } from '../../credentials';
import { withRateLimitRetry } from '../rateLimiter';
import { getTossRateLimiter, type TossRateLimitGroup } from './rateLimitGroups';
import { DEFAULT_TTL_MS, PORTFOLIO_TTL_MS, withCache } from '../responseCache';
import { getCachedCloses, setCachedCloses, type CachedSymbolCloses } from '../../db/monthlyCloseCache';
import type { FetchOpts } from '../types';

const BASE_URL = 'https://openapi.tossinvest.com';

// --- Raw response shapes, per https://openapi.tossinvest.com/openapi-docs/latest/openapi.json
// (verified 2026-08-12) ---
//
// Toss's OpenAPI spec declares every money/quantity/rate field as
// `{ type: "string", format: "decimal" }`, NOT a JSON number — deliberate,
// presumably to avoid float precision loss on money. The Raw* interfaces
// below describe that actual wire shape; toNum() converts them to real
// numbers before anything outside this file sees them. Getting this wrong
// silently breaks in JS-specific ways rather than throwing: Math.round(),
// `*`, and Intl.NumberFormat.format() all coerce a numeric string to a
// number and "just work", but `+` does string concatenation instead of
// addition — which is exactly what made the portfolio weight calculation
// (Dashboard.tsx, `convertedValues.reduce((sum, v) => sum + v)`) silently
// produce garbage while every other column looked fine.

interface TossTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
}

interface TossAccountsResponse {
  result: Array<{
    accountNo: string;
    accountSeq: number; // a real JSON number per the schema, unlike the fields below
    accountType: string;
  }>;
}

interface RawTossPrice {
  krw: string;
  usd: string | null;
}

interface RawTossHoldingsOverviewResponse {
  totalPurchaseAmount: RawTossPrice;
  marketValue: { amount: RawTossPrice; amountAfterCost: RawTossPrice };
  profitLoss: { amount: RawTossPrice; amountAfterCost: RawTossPrice; rate: string; rateAfterCost: string };
  dailyProfitLoss?: unknown;
  items: RawTossHoldingsItem[];
}

interface RawTossHoldingsItem {
  symbol: string;
  name: string;
  marketCountry: string;
  currency: string;
  quantity: string;
  lastPrice: string;
  averagePurchasePrice: string;
  marketValue: { purchaseAmount: string; amount: string; amountAfterCost: string };
  profitLoss: { amount: string; amountAfterCost: string; rate: string; rateAfterCost: string };
  dailyProfitLoss?: unknown;
  cost: { commission: string; tax: string | null };
}

interface RawTossOrderExecution {
  filledQuantity: string;
  averageFilledPrice: string | null;
  filledAmount: string | null;
  commission: string | null;
  tax: string | null;
  filledAt: string | null;
  settlementDate: string | null;
}

interface RawTossOrder {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  status: string;
  price: string | null;
  quantity: string;
  currency: string;
  orderedAt: string;
  execution: RawTossOrderExecution;
}

interface RawTossOrdersResponse {
  orders: RawTossOrder[];
  nextCursor: string | null;
  hasNext: boolean;
}

interface RawTossExchangeRateResponse {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  midRate: string | null;
  basisPoint?: string | null;
  rateChangeType?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
}

/** Parsed (real-number) shapes — what this module returns to callers. */
interface TossPrice {
  krw: number;
  usd: number | null;
}

interface TossHoldingsOverviewResponse {
  totalPurchaseAmount: TossPrice;
  marketValue: { amount: TossPrice; amountAfterCost: TossPrice };
  profitLoss: { amount: TossPrice; amountAfterCost: TossPrice; rate: number; rateAfterCost: number };
  dailyProfitLoss?: unknown;
  items: TossHoldingsItem[];
}

interface TossExchangeRateResponse {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  midRate: number | null;
  basisPoint?: number | null;
  rateChangeType?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
}

interface TossHoldingsItem {
  symbol: string;
  name: string;
  marketCountry: string;
  currency: string;
  quantity: number;
  lastPrice: number;
  averagePurchasePrice: number;
  marketValue: { purchaseAmount: number; amount: number; amountAfterCost: number };
  profitLoss: { amount: number; amountAfterCost: number; rate: number; rateAfterCost: number };
  dailyProfitLoss?: unknown;
  cost: { commission: number; tax: number | null };
}

interface TossOrder {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number | null;
  quantity: number;
  currency: string;
  orderedAt: string;
  execution: {
    filledQuantity: number;
    averageFilledPrice: number | null;
    filledAmount: number | null;
    commission: number | null;
    tax: number | null;
    filledAt: string | null;
  };
}

function toNum(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`토스증권 API가 숫자로 파싱할 수 없는 값을 반환했습니다: ${JSON.stringify(value)}`);
  }
  return n;
}

function parsePrice(p: RawTossPrice): TossPrice {
  return { krw: toNum(p.krw), usd: p.usd === null ? null : toNum(p.usd) };
}

function parseHoldingsItem(item: RawTossHoldingsItem): TossHoldingsItem {
  return {
    symbol: item.symbol,
    name: item.name,
    marketCountry: item.marketCountry,
    currency: item.currency,
    quantity: toNum(item.quantity),
    lastPrice: toNum(item.lastPrice),
    averagePurchasePrice: toNum(item.averagePurchasePrice),
    marketValue: {
      purchaseAmount: toNum(item.marketValue.purchaseAmount),
      amount: toNum(item.marketValue.amount),
      amountAfterCost: toNum(item.marketValue.amountAfterCost),
    },
    profitLoss: {
      amount: toNum(item.profitLoss.amount),
      amountAfterCost: toNum(item.profitLoss.amountAfterCost),
      rate: toNum(item.profitLoss.rate),
      rateAfterCost: toNum(item.profitLoss.rateAfterCost),
    },
    dailyProfitLoss: item.dailyProfitLoss,
    cost: {
      commission: toNum(item.cost.commission),
      tax: item.cost.tax === null || item.cost.tax === undefined ? null : toNum(item.cost.tax),
    },
  };
}

function parseOrder(o: RawTossOrder): TossOrder {
  return {
    orderId: o.orderId,
    symbol: o.symbol,
    side: o.side,
    price: o.price === null ? null : toNum(o.price),
    quantity: toNum(o.quantity),
    currency: o.currency,
    orderedAt: o.orderedAt,
    execution: {
      filledQuantity: toNum(o.execution.filledQuantity),
      averageFilledPrice:
        o.execution.averageFilledPrice === null ? null : toNum(o.execution.averageFilledPrice),
      filledAmount: o.execution.filledAmount === null ? null : toNum(o.execution.filledAmount),
      commission: o.execution.commission === null ? null : toNum(o.execution.commission),
      tax: o.execution.tax === null ? null : toNum(o.execution.tax),
      filledAt: o.execution.filledAt,
    },
  };
}

class TossApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = 'TossApiError';
  }
}

// One in-memory token cache per process. Toss issues a single valid token
// per client (reissuing invalidates the previous one), so we deliberately
// don't refresh speculatively — only when expired/near-expiry or on 401.
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

// Two concurrent callers that both see an expired/missing cachedToken (e.g.
// two screens' requests landing at the same moment right after expiry) would
// otherwise each fire their own `/oauth2/token` request — and since Toss
// invalidates the previous token on every reissue (comment above), whichever
// request loses the race gets a token that's already dead, 401s, and forces
// yet another reissue. Sharing one in-flight fetch across concurrent callers
// avoids both the wasted call and the self-inflicted invalidation.
let inFlightFetch: Promise<string> | null = null;

async function fetchTokenUncached(): Promise<string> {
  const creds = getCredentialFields('toss');
  if (!creds) {
    throw new Error('토스증권 API 키가 설정되지 않았습니다. 설정 화면에서 Client ID/Secret을 입력해주세요.');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const authLimiter = getTossRateLimiter('AUTH');
  const res = await authLimiter.schedule(() =>
    withRateLimitRetry(
      () =>
        fetch(`${BASE_URL}/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        }),
      (r) => authLimiter.learnFromHeaders(r)
    )
  );

  if (!res.ok) {
    throw new TossApiError('토스증권 토큰 발급 실패', res.status, await res.text());
  }

  const data = (await res.json()) as TossTokenResponse;
  // 60s safety buffer before expiry.
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.accessToken;
}

function fetchToken(): Promise<string> {
  if (!inFlightFetch) {
    inFlightFetch = fetchTokenUncached().finally(() => {
      inFlightFetch = null;
    });
  }
  return inFlightFetch;
}

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  return fetchToken();
}

async function tossFetch<T>(
  path: string,
  group: TossRateLimitGroup,
  opts: { accountSeq?: number } = {}
): Promise<T> {
  const doFetch = async (token: string) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (opts.accountSeq !== undefined) {
      headers['X-Tossinvest-Account'] = String(opts.accountSeq);
    }
    return fetch(`${BASE_URL}${path}`, { headers });
  };

  const limiter = getTossRateLimiter(group);
  const res = await limiter.schedule(async () => {
    const learn = (r: Response) => limiter.learnFromHeaders(r);

    let token = await getToken();
    let response = await withRateLimitRetry(() => doFetch(token), learn);

    if (response.status === 401) {
      // Token may have expired early or been invalidated — refresh once and retry.
      token = await getToken(true);
      response = await withRateLimitRetry(() => doFetch(token), learn);
    }

    return response;
  });

  const text = await res.text();

  if (!res.ok) {
    throw new TossApiError(`토스증권 API 호출 실패: ${path}`, res.status, text);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TossApiError(`토스증권 API 응답 파싱 실패: ${path}`, res.status, text);
  }
}

export function isTossConfigured(): boolean {
  // Existence check only — decrypting (getCredentialFields) isn't needed
  // just to answer "is this set up", and doing it here meant every
  // GET /api/accounts call risked throwing on a decrypt failure.
  return hasCredential('toss');
}

export async function fetchTossAccounts(opts: FetchOpts = {}): Promise<TossAccountsResponse['result']> {
  return withCache(
    'toss:accounts',
    PORTFOLIO_TTL_MS,
    async () => {
      const data = await tossFetch<TossAccountsResponse>('/api/v1/accounts', 'ACCOUNT');
      return data.result;
    },
    opts
  );
}

export async function fetchTossHoldings(
  accountSeq: number,
  opts: FetchOpts = {}
): Promise<TossHoldingsOverviewResponse> {
  return withCache(
    `toss:holdings:${accountSeq}`,
    PORTFOLIO_TTL_MS,
    async () => {
      // Holdings/balance falls under the docs' ASSET group (5 req/s), distinct
      // from ACCOUNT (1 req/s, accounts list only) — conflating the two was
      // the original cause of hitting the 1 req/s limit on first page load.
      const raw = await tossFetch<any>('/api/v1/holdings', 'ASSET', { accountSeq });

      // /api/v1/accounts wraps its payload in { result: ... } — /api/v1/holdings
      // may or may not follow the same envelope depending on the live API, so
      // accept either shape rather than assuming one.
      const overview = raw?.result ?? raw;

      if (!overview || typeof overview !== 'object' || !Array.isArray(overview.items)) {
        console.error('[toss] Unexpected /api/v1/holdings response shape:', JSON.stringify(raw));
        throw new Error(
          '토스증권 보유 종목 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했으니 ' +
            '확인 후 backend/src/brokers/toss/tossClient.ts의 TossHoldingsOverviewResponse 매핑을 맞춰주세요.'
        );
      }

      const rawOverview = overview as RawTossHoldingsOverviewResponse;
      return {
        totalPurchaseAmount: parsePrice(rawOverview.totalPurchaseAmount),
        marketValue: {
          amount: parsePrice(rawOverview.marketValue.amount),
          amountAfterCost: parsePrice(rawOverview.marketValue.amountAfterCost),
        },
        profitLoss: {
          amount: parsePrice(rawOverview.profitLoss.amount),
          amountAfterCost: parsePrice(rawOverview.profitLoss.amountAfterCost),
          rate: toNum(rawOverview.profitLoss.rate),
          rateAfterCost: toNum(rawOverview.profitLoss.rateAfterCost),
        },
        dailyProfitLoss: rawOverview.dailyProfitLoss,
        items: rawOverview.items.map(parseHoldingsItem),
      };
    },
    opts
  );
}

/** `from`/`to` are inclusive YYYY-MM-DD (`orderedAt`-based, per docs). */
export async function fetchTossOrders(
  accountSeq: number,
  from: string,
  to: string,
  opts: FetchOpts = {}
): Promise<TossOrder[]> {
  return withCache(
    `toss:orders:${accountSeq}:${from}:${to}`,
    DEFAULT_TTL_MS,
    async () => {
      const orders: TossOrder[] = [];
      let cursor: string | undefined;

      // status=CLOSED covers FILLED/CANCELED/REJECTED/... — filtered down to
      // actually-filled quantity by the caller (kis and toss both report
      // execution.filledQuantity/tot_ccld_qty separately from the requested
      // order quantity, since a CLOSED order can be a cancel with 0 fills).
      for (let page = 0; page < 50; page++) {
        const params = new URLSearchParams({ status: 'CLOSED', from, to, limit: '100' });
        if (cursor) params.set('cursor', cursor);

        const raw = await tossFetch<any>(`/api/v1/orders?${params}`, 'ORDER_HISTORY', { accountSeq });
        const data = (raw?.result ?? raw) as RawTossOrdersResponse;

        if (!data || !Array.isArray(data.orders)) {
          console.error('[toss] Unexpected /api/v1/orders response shape:', JSON.stringify(raw));
          throw new Error(
            '토스증권 매매내역 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
          );
        }

        orders.push(...data.orders.map(parseOrder));
        if (!data.hasNext || !data.nextCursor) break;
        cursor = data.nextCursor;
      }

      return orders;
    },
    opts
  );
}

/**
 * 매수 가능 금액 조회 (`GET /api/v1/buying-power`, `ORDER_INFO` group, 공식
 * OpenAPI 스펙 확인 2026-08-19) — 계좌에 "예수금" 자체를 돌려주는 엔드포인트가
 * 없어서 이걸로 대체한다. 문서상 "미수거래를 제외한 현금 기반 매수 가능 금액
 * (미수 미발생 기준)"이라 일반적인 현금 계좌에선 예수금과 거의 같지만, 매도
 * 후 T+2 미정산분이 있는 시점엔 정확한 "지금 당장의 예수금"과 살짝 다를 수
 * 있다(엄밀히 다른 개념) — 화면에 이 근사를 안내한다.
 */
export async function fetchTossBuyingPower(
  accountSeq: number,
  currency: 'KRW' | 'USD',
  opts: FetchOpts = {}
): Promise<number> {
  return withCache(
    `toss:buying-power:${accountSeq}:${currency}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const params = new URLSearchParams({ currency });
      const raw = await tossFetch<any>(`/api/v1/buying-power?${params}`, 'ORDER_INFO', { accountSeq });
      const data = raw?.result ?? raw;

      if (!data || typeof data !== 'object' || typeof data.cashBuyingPower !== 'string') {
        console.error('[toss] Unexpected /api/v1/buying-power response shape:', JSON.stringify(raw));
        throw new Error(
          '토스증권 매수 가능 금액(예수금) 조회 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
        );
      }

      return toNum(data.cashBuyingPower);
    },
    opts
  );
}

export async function fetchTossExchangeRate(
  baseCurrency: string,
  quoteCurrency: string,
  opts: FetchOpts = {}
): Promise<TossExchangeRateResponse> {
  return withCache(
    `toss:fx:${baseCurrency}:${quoteCurrency}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const params = new URLSearchParams({ baseCurrency, quoteCurrency });
      const raw = await tossFetch<any>(`/api/v1/exchange-rate?${params}`, 'MARKET_INFO');
      const data = raw?.result ?? raw;

      // rate is a decimal-formatted STRING per the schema ("1380.5"), not a
      // JSON number — checking `typeof data.rate !== 'number'` here always
      // failed against a real response, so this call silently threw on
      // every live use. Dashboard.tsx swallows that failure (live rate is
      // a nice-to-have, falls back to the manual rate), which is why it
      // went unnoticed rather than surfacing as an error.
      if (!data || typeof data !== 'object' || typeof data.rate !== 'string') {
        console.error('[toss] Unexpected /api/v1/exchange-rate response shape:', JSON.stringify(raw));
        throw new Error(
          '토스증권 환율 조회 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
        );
      }

      const rawRate = data as RawTossExchangeRateResponse;
      return {
        baseCurrency: rawRate.baseCurrency,
        quoteCurrency: rawRate.quoteCurrency,
        rate: toNum(rawRate.rate),
        midRate: rawRate.midRate === null || rawRate.midRate === undefined ? null : toNum(rawRate.midRate),
        basisPoint:
          rawRate.basisPoint === null || rawRate.basisPoint === undefined ? null : toNum(rawRate.basisPoint),
        rateChangeType: rawRate.rateChangeType ?? null,
        validFrom: rawRate.validFrom ?? null,
        validUntil: rawRate.validUntil ?? null,
      };
    },
    opts
  );
}

interface RawTossStockInfo {
  symbol: string;
  name: string;
  englishName: string | null;
  market: string;
  securityType: string;
  status: string;
  currency: string;
}

/**
 * 종목 기본 정보 조회 (`GET /api/v1/stocks`, `STOCK` group) — not
 * account-scoped, works for both KR (e.g. "005930") and US (e.g. "AAPL")
 * symbols in the same call, up to 200 comma-separated per request per docs.
 * Used to auto-resolve a dividend record's 종목명 from its 종목코드 (see
 * routes/stockInfo.ts) instead of asking the user to type it.
 */
export async function fetchTossStockInfo(symbols: string[], opts: FetchOpts = {}): Promise<RawTossStockInfo[]> {
  const key = [...symbols].sort().join(',');
  return withCache(
    `toss:stockinfo:${key}`,
    DEFAULT_TTL_MS,
    async () => {
      const params = new URLSearchParams({ symbols: symbols.join(',') });
      const raw = await tossFetch<any>(`/api/v1/stocks?${params}`, 'STOCK');
      const data = raw?.result ?? raw;

      if (!Array.isArray(data)) {
        console.error('[toss] Unexpected /api/v1/stocks response shape:', JSON.stringify(raw));
        throw new Error(
          '토스증권 종목정보 조회 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
        );
      }

      return data as RawTossStockInfo[];
    },
    opts
  );
}

interface RawTossPriceItem {
  symbol: string;
  timestamp: string | null;
  lastPrice: string;
  currency: string;
}

export interface TossPriceItem {
  symbol: string;
  lastPrice: number;
  currency: string;
}

/**
 * 현재가 조회 (`GET /api/v1/prices`, `MARKET_DATA` group, 공식 스펙
 * openapi.tossinvest.com/openapi-docs/latest/openapi.json 확인, checked
 * 2026-08-17) — `/api/v1/stocks`처럼 계좌와 무관하고 KR/US 심볼을 한 API로
 * 커버하며 최대 200개 콤마 동시조회. `lastPrice`는 다른 토스 금액 필드와
 * 마찬가지로 문자열(`format: decimal`)로 내려와서 여기서 number로 변환해
 * 넘긴다. 보유종목 CSV 가져오기가 사용자가 안 채운 현재가/평가금액/손익을
 * 자동으로 채우는 데 쓴다(routes/holdingsStore.ts).
 */
export async function fetchTossPrices(symbols: string[], opts: FetchOpts = {}): Promise<TossPriceItem[]> {
  const key = [...symbols].sort().join(',');
  return withCache(
    `toss:prices:${key}`,
    DEFAULT_TTL_MS,
    async () => {
      const params = new URLSearchParams({ symbols: symbols.join(',') });
      const raw = await tossFetch<any>(`/api/v1/prices?${params}`, 'MARKET_DATA');
      const data = raw?.result ?? raw;

      if (!Array.isArray(data)) {
        console.error('[toss] Unexpected /api/v1/prices response shape:', JSON.stringify(raw));
        throw new Error(
          '토스증권 현재가 조회 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
        );
      }

      return (data as RawTossPriceItem[]).map((item) => ({
        symbol: item.symbol,
        lastPrice: toNum(item.lastPrice),
        currency: item.currency,
      }));
    },
    opts
  );
}

interface RawTossCandle {
  timestamp: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  currency: string;
}

interface RawTossCandlesResponse {
  candles: RawTossCandle[];
  nextBefore: string | null;
}

interface TossCandle {
  timestamp: string;
  closePrice: number;
  currency: string;
}

/**
 * 일봉 한 페이지 조회 (`GET /api/v1/candles`, `MARKET_DATA_CHART` group, 공식
 * 스펙 openapi.tossinvest.com/openapi-docs/latest/openapi.json 확인, checked
 * 2026-08-17) — `/api/v1/prices`처럼 계좌 무관, KR/US 심볼 공통. 한 번에 최대
 * 200봉까지만 주므로(`count`), 여러 달치가 필요하면 `before`(직전 응답의
 * `nextBefore`)로 과거로 페이지네이션한다. `interval`은 `1d`(일봉)만 쓴다 —
 * 월봉 자체는 API에 없어서, 일봉을 모아 이 파일 아래 `fetchTossMonthlyClosePrices`가
 * 달마다 마지막 거래일 종가를 직접 뽑는다.
 */
// 이미 지나간 달의 종가는 다시 바뀌지 않는다(오늘이 속한 달의 봉만 장중에
// 계속 움직임) — 다른 broker 응답처럼 5초짜리 DEFAULT_TTL_MS를 쓰면 대시보드를
// 새로고침할 때마다(또는 여러 종목이 겹칠 때마다) 매번 다시 받아오게 되고,
// 종목 수만큼 호출이 늘어나는 이 엔드포인트 특성상(Overview.tsx가 대시보드
// 진입/새로고침마다 부름) 그 비용이 특히 크다. 몇 시간 단위로 넉넉히 캐싱해도
// "오늘 달의 종가가 몇 시간 묵을 수 있다"는 정도의 오차만 생기고, 그마저도
// 이미 fallback(오늘 현재가)이 있는 값이라 감수할 만하다.
const CANDLE_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4시간

async function fetchTossDailyCandlesPage(
  symbol: string,
  before: string | undefined,
  opts: FetchOpts = {}
): Promise<{ candles: TossCandle[]; nextBefore: string | null }> {
  const params = new URLSearchParams({ symbol, interval: '1d', count: '200' });
  if (before) params.set('before', before);
  return withCache(
    `toss:candles:${symbol}:${before ?? 'latest'}`,
    CANDLE_CACHE_TTL_MS,
    async () => {
      const raw = await tossFetch<any>(`/api/v1/candles?${params}`, 'MARKET_DATA_CHART');
      const data = (raw?.result ?? raw) as RawTossCandlesResponse;

      if (!data || !Array.isArray(data.candles)) {
        console.error('[toss] Unexpected /api/v1/candles response shape:', JSON.stringify(raw));
        throw new Error('토스증권 일봉 조회 응답 형식이 예상과 다릅니다.');
      }

      return {
        candles: data.candles.map((c) => ({
          timestamp: c.timestamp,
          closePrice: toNum(c.closePrice),
          currency: c.currency,
        })),
        nextBefore: data.nextBefore ?? null,
      };
    },
    opts
  );
}

export interface MonthlyClosePrice {
  /** "YYYY-MM" */
  month: string;
  closePrice: number;
  currency: string;
}

function yearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return yearMonth(d);
}

function toMonthlyList(byMonth: Map<string, { closePrice: number; currency: string }>): MonthlyClosePrice[] {
  return Array.from(byMonth.entries())
    .map(([month, c]) => ({ month, closePrice: c.closePrice, currency: c.currency }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

/**
 * 종목 하나의 최근 `months`개월치 "월별 종가"(그 달의 마지막 거래일 종가)를
 * 구한다 — 일봉을 과거로 페이지네이션하며 모은 뒤 달마다 가장 최근(=timestamp가
 * 가장 큰) 봉의 종가를 고른다. 달력상 마지막 날이 아니라 "그 달 마지막 거래일"
 * 기준이라 휴장일/공휴일과 무관하게 항상 값이 나온다. 실패해도(토스 미연동,
 * 상장폐지/오타 등으로 종목을 못 찾음, 네트워크 오류) 예외를 던지지 않고 빈
 * 배열을 준다 — 호출부(Overview.tsx)가 그 종목/그 달은 오늘 현재가로 대체하는
 * fallback을 이미 갖고 있어서, 여기서 막을 이유가 없다.
 *
 * **확정된 달은 디스크에 영구 캐시한다**(`db/monthlyCloseCache.ts`) — 캐시가
 * 요청 범위를 이미 덮고 있으면 최신 일봉 한 페이지(이번 달·지난달 포함, 약
 * 9개월치)만 받아 합친다. "확정"은 지난달보다 이전 달만 친다 — 지난달 마지막
 * 거래일 종가는 한국 시간 1일 새벽(미국장 마감)까지 아직 안 나왔을 수 있어서,
 * 한 달 여유를 둬도 최신 페이지 하나에 항상 들어가므로 추가 비용이 없다.
 */
export async function fetchTossMonthlyClosePrices(
  symbol: string,
  months: number,
  opts: FetchOpts = {}
): Promise<MonthlyClosePrice[]> {
  if (!isTossConfigured()) return [];

  const finalizedBefore = monthsAgo(1); // 이 달 "미만"만 확정으로 취급
  const requiredFrom = monthsAgo(months);
  let cached: CachedSymbolCloses | null = null;
  try {
    cached = getCachedCloses(symbol);
  } catch (err) {
    console.error(`[toss] 월별 종가 캐시 읽기 실패 (${symbol}):`, err);
  }

  const byMonth = new Map<string, { closePrice: number; currency: string; timestamp: string }>();
  const mergePage = (candles: TossCandle[]) => {
    for (const c of candles) {
      const month = c.timestamp.slice(0, 7);
      const existing = byMonth.get(month);
      if (!existing || c.timestamp > existing.timestamp) {
        byMonth.set(month, { closePrice: c.closePrice, currency: c.currency, timestamp: c.timestamp });
      }
    }
  };

  try {
    if (cached && cached.coveredFrom <= requiredFrom) {
      const { candles } = await fetchTossDailyCandlesPage(symbol, undefined, opts);
      mergePage(candles);
      const merged = new Map<string, { closePrice: number; currency: string }>(Object.entries(cached.months));
      for (const [month, c] of byMonth) merged.set(month, c);
      return toMonthlyList(merged);
    }

    let before: string | undefined;
    let reachedStart = false;
    // 하루 평균 거래일 ~21일 기준 200봉 ≈ 9~10개월치라, 대부분 1~2페이지면
    // 충분하다. 상장 시작이 얼마 안 된 종목처럼 nextBefore가 일찍 null이 되는
    // 경우를 대비해 페이지 수 상한만 넉넉히(5) 둔다.
    for (let page = 0; page < 5; page++) {
      const { candles, nextBefore } = await fetchTossDailyCandlesPage(symbol, before, opts);
      if (candles.length === 0) {
        reachedStart = page > 0;
        break;
      }
      mergePage(candles);
      if (!nextBefore) {
        reachedStart = true;
        break;
      }
      if (byMonth.size >= months + 2) break;
      before = nextBefore;
    }

    if (byMonth.size > 0) {
      const finalized: CachedSymbolCloses['months'] = { ...(cached?.months ?? {}) };
      for (const [month, c] of byMonth) {
        if (month < finalizedBefore) finalized[month] = { closePrice: c.closePrice, currency: c.currency };
      }
      const earliestFetched = [...byMonth.keys()].sort()[0];
      const coveredFrom = reachedStart ? '0000-00' : earliestFetched;
      try {
        setCachedCloses(symbol, { coveredFrom, months: finalized });
      } catch (err) {
        console.error(`[toss] 월별 종가 캐시 저장 실패 (${symbol}):`, err);
      }
    }

    return toMonthlyList(byMonth);
  } catch (err) {
    console.error(`[toss] 월별 종가 조회 실패 (${symbol}):`, err);
    // 최신 페이지 조회만 실패했으면 확정된 달이라도 돌려준다 — 그 달들은 어차피
    // 다시 안 바뀌는 값이라 프론트의 "오늘 현재가로 대체"보다 정확하다.
    return cached ? toMonthlyList(new Map(Object.entries(cached.months))) : [];
  }
}

/**
 * Toss's own `name` falls back to the bare ticker (e.g. `"SPY"`, `"NVDY"`)
 * for securities with no registered Korean short name — confirmed against
 * the live API for several US ETFs (checked 2026-08-14): `name` and
 * `symbol` were identical, while `englishName` had the real name (e.g.
 * `"SPDR S&P 500 ETF Trust"`, `"YIELDMAX NVDA OPTION INCOME STRATEGY ETF"`).
 * Prefer that over just showing the ticker again. Doesn't apply to Korean
 * stocks or well-known US names (Toss does have a Korean `name` for those,
 * e.g. AAPL → "애플").
 */
export function displayNameOf(info: { symbol: string; name: string; englishName: string | null }): string {
  if (info.name.toUpperCase() !== info.symbol.toUpperCase()) return info.name;
  return info.englishName?.trim() || info.name;
}

export type { TossHoldingsOverviewResponse, TossHoldingsItem, TossExchangeRateResponse, TossOrder };
export { TossApiError };
