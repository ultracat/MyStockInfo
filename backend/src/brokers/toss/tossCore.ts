// 토스증권 Open API 공통부 — 응답 원형 타입·숫자 변환·토큰(메모리, 동시 발급 방지)·요청 함수·속도 제한.
// tossClient.ts를 2026-11-17 여러 파일로 나눴다. 다른 코드는 계속 tossClient.ts에서 import한다.
import { getCredentialFields } from '../../credentials';
import { withRateLimitRetry } from '../rateLimiter';
import { getTossRateLimiter, type TossRateLimitGroup } from './rateLimitGroups';
import type { components } from './tossSpec.gen';
import { noteResponse } from '../responseShape';
import { createTokenManager } from '../tokenManager';
import { fetchWithTimeout } from '../../http/fetchWithTimeout';

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

// 원형 타입은 공식 명세에서 생성한 tossSpec.gen.ts를 그대로 쓴다(2026-11-17 — 예전엔 손으로 옮겨 적었다).
// 명세가 바뀌면 `npm run spec:check`가 알리고, `spec:update` 뒤 `npm run build`가 어긋난 곳을 타입 오류로 짚는다.
// ⚠ 명세상 생략될 수 있는 필드(`usd?`, `price?`, `tax?`)가 있다 — `=== null`이 아니라 `== null`로 본다.
type Schemas = components['schemas'];
type TossTokenResponse = Schemas['OAuth2TokenResponse'];
export interface TossAccountsResponse {
  result: Schemas['Account'][];
}
type RawTossPrice = Schemas['Price'];
export type RawTossHoldingsOverviewResponse = Schemas['HoldingsOverview'];
type RawTossHoldingsItem = Schemas['HoldingsItem'];
type RawTossOrder = Schemas['Order'];
export type RawTossOrdersResponse = Schemas['PaginatedOrderResponse'];
export type RawTossExchangeRateResponse = Schemas['ExchangeRateResponse'];

/** Parsed (real-number) shapes — what this module returns to callers. */
interface TossPrice {
  krw: number;
  usd: number | null;
}

export interface TossHoldingsOverviewResponse {
  totalPurchaseAmount: TossPrice;
  marketValue: { amount: TossPrice; amountAfterCost: TossPrice };
  profitLoss: { amount: TossPrice; amountAfterCost: TossPrice; rate: number; rateAfterCost: number };
  dailyProfitLoss?: unknown;
  items: TossHoldingsItem[];
}

export interface TossExchangeRateResponse {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  midRate: number | null;
  basisPoint?: number | null;
  rateChangeType?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface TossHoldingsItem {
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

export interface TossOrder {
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

export function toNum(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`토스증권 API가 숫자로 파싱할 수 없는 값을 반환했습니다: ${JSON.stringify(value)}`);
  }
  return n;
}

export function parsePrice(p: RawTossPrice): TossPrice {
  return { krw: toNum(p.krw), usd: p.usd == null ? null : toNum(p.usd) };
}

export function parseHoldingsItem(item: RawTossHoldingsItem): TossHoldingsItem {
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
      tax: item.cost.tax == null ? null : toNum(item.cost.tax),
    },
  };
}

export function parseOrder(o: RawTossOrder): TossOrder {
  return {
    orderId: o.orderId,
    symbol: o.symbol,
    side: o.side,
    price: o.price == null ? null : toNum(o.price),
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

export class TossApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = 'TossApiError';
  }
}

// 토큰은 메모리에만 둔다(실행마다 새로 받는다). 토스는 클라이언트당 유효 토큰이 하나뿐이라(재발급하면 이전 토큰이
// 바로 무효) 미리 갱신하지 않고 만료 임박·401일 때만 받는다. 동시 발급 공유·401 재발급 경쟁 방지(staleToken 비교)·
// Client ID 해시·자격증명 변경 시 무효화는 공용 tokenManager.ts — 예전엔 401마다 무조건 재발급해서, 동시에 401을 받은
// 요청들이 서로 막 받은 토큰을 다시 무효화했다(2026-11-26 리뷰).
const tokens = createTokenManager({
  broker: 'toss',
  persist: false,
  async loadCreds() {
    const creds = await getCredentialFields('toss');
    if (!creds) {
      throw new Error('토스증권 API 키가 설정되지 않았습니다. 설정 화면에서 Client ID/Secret을 입력해주세요.');
    }
    return creds;
  },
  keyOf: (creds) => creds.clientId,
  async issue(creds) {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    });

    const authLimiter = getTossRateLimiter('AUTH');
    const res = await authLimiter.schedule(() =>
      withRateLimitRetry(
        () =>
          fetchWithTimeout(`${BASE_URL}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            label: '토스증권',
          }),
        (r) => authLimiter.learnFromHeaders(r)
      )
    );

    if (!res.ok) {
      throw new TossApiError('토스증권 토큰 발급 실패', res.status, await res.text());
    }

    const data = (await res.json()) as TossTokenResponse;
    // 60s safety buffer before expiry.
    return { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  },
});

export async function tossFetch<T>(
  path: string,
  group: TossRateLimitGroup,
  opts: { accountSeq?: number } = {}
): Promise<T> {
  const doFetch = async (token: string) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (opts.accountSeq !== undefined) {
      headers['X-Tossinvest-Account'] = String(opts.accountSeq);
    }
    return fetchWithTimeout(`${BASE_URL}${path}`, { headers, label: '토스증권' });
  };

  const limiter = getTossRateLimiter(group);
  const res = await limiter.schedule(async () => {
    const learn = (r: Response) => limiter.learnFromHeaders(r);

    let token = await tokens.getToken();
    let response = await withRateLimitRetry(() => doFetch(token), learn);

    if (response.status === 401) {
      // 토큰이 일찍 만료됐거나 무효화됐다 — 한 번만 다시 받아 재시도. 실패한 토큰을 넘겨서, 그새 다른 요청이 이미
      // 새로 받았으면 또 발급하지 않고 그걸 쓴다(토스는 재발급하면 이전 토큰이 무효라 겹쳐 받으면 서로를 죽인다).
      token = await tokens.getToken(token);
      response = await withRateLimitRetry(() => doFetch(token), learn);
    }

    return response;
  });

  const text = await res.text();

  if (!res.ok) {
    throw new TossApiError(`토스증권 API 호출 실패: ${path}`, res.status, text);
  }

  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    throw new TossApiError(`토스증권 API 응답 파싱 실패: ${path}`, res.status, text);
  }
  // 응답 모양 관찰(값 없이) — 실제 응답 기록(toss-live.json)과 필드가 달라졌으면 로그에 한 번 경고, --record면 모양을 모은다.
  noteResponse('toss', tossPathTemplate(path), parsed);
  return parsed;
}

/** 요청 경로 → 기록·비교에 쓰는 이름(쿼리를 떼고 종목·섹터 같은 경로 변수를 `{…}`로). */
export function tossPathTemplate(path: string): string {
  const p = path.split('?')[0];
  return p
    .replace(/^\/api\/v1\/stocks\/[^/]+\/warnings$/, '/api/v1/stocks/{symbol}/warnings')
    .replace(/^\/api\/v1\/market-indicators\/[^/]+\/candles$/, '/api/v1/market-indicators/{symbol}/candles')
    .replace(/^\/api\/v1\/sectors\/[^/]+\/stocks$/, '/api/v1/sectors/{sectorId}/stocks')
    .replace(/^\/api\/v1\/sectors\/[^/]+\/etfs$/, '/api/v1/sectors/{sectorId}/etfs');
}
