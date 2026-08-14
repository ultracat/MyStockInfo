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

export type { TossHoldingsOverviewResponse, TossHoldingsItem, TossExchangeRateResponse };
export { TossApiError };
