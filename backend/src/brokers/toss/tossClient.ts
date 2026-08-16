import { getCredentialFields, hasCredential } from '../../credentials';
import { withRateLimitRetry } from '../rateLimiter';
import { getTossRateLimiter, type TossRateLimitGroup } from './rateLimitGroups';
import { DEFAULT_TTL_MS, withCache } from '../responseCache';
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

async function fetchToken(): Promise<string> {
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
    DEFAULT_TTL_MS,
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
    DEFAULT_TTL_MS,
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

export async function fetchTossExchangeRate(
  baseCurrency: string,
  quoteCurrency: string,
  opts: FetchOpts = {}
): Promise<TossExchangeRateResponse> {
  return withCache(
    `toss:fx:${baseCurrency}:${quoteCurrency}`,
    DEFAULT_TTL_MS,
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
