import { RateLimiter, type RateLimitGroupConfig } from '../rateLimiter';

// developers.tossinvest.com/docs — Rate Limits (checked 2026-08-12).
// Limits are per-client × per-API-group TPS; this is the full documented
// table, used as the fallback until each group's RateLimiter has learned
// the real value from X-RateLimit-Limit response headers. Only AUTH,
// ACCOUNT, and ASSET are wired to an endpoint today (token issuance,
// accounts, holdings) — the rest are here so future endpoints (market
// data, orders, ...) just look up their group instead of guessing a limit.
const PEAK_09_00_TO_09_10_KST = { startHourKst: 9, startMinuteKst: 0, endHourKst: 9, endMinuteKst: 10 };

const TOSS_RATE_LIMIT_GROUPS = {
  AUTH: { tps: 5 },
  ACCOUNT: { tps: 1 },
  ASSET: { tps: 5 },
  STOCK: { tps: 5 },
  STOCK_ALL: { tps: 1 },
  STOCK_TRADING_TREND: { tps: 10 },
  MARKET_INFO: { tps: 3 },
  MARKET_DATA: { tps: 15 },
  MARKET_DATA_CHART: { tps: 20 },
  RANKING: { tps: 5 },
  MARKET_INDICATOR_PRICE: { tps: 10 },
  MARKET_INDICATOR: { tps: 10 },
  MARKET_INDICATOR_CHART: { tps: 5 },
  // ORDER's peak-hour figure is published as the same 10 tps as its base
  // rate (no actual reduction) — kept explicit so a future doc update that
  // does change it is a one-line edit here, not a new code path.
  ORDER: { tps: 10, peak: { ...PEAK_09_00_TO_09_10_KST, tps: 10 } },
  ORDER_HISTORY: { tps: 5 },
  ORDER_INFO: { tps: 6, peak: { ...PEAK_09_00_TO_09_10_KST, tps: 3 } },
  CONDITIONAL_ORDER: { tps: 5 },
  CONDITIONAL_ORDER_HISTORY: { tps: 10 },
  // 거래내역 조회(GET /api/v1/transactions) — 2026-11-09 overview.md Rate Limits 표 기준 초당 5회.
  TRANSACTION: { tps: 5 },
  // 섹터(목록·구성 주식) — 2026-11-09 overview.md 기준 초당 5회.
  SECTOR: { tps: 5 },
} as const satisfies Record<string, RateLimitGroupConfig>;

export type TossRateLimitGroup = keyof typeof TOSS_RATE_LIMIT_GROUPS;

const instances = new Map<TossRateLimitGroup, RateLimiter>();

export function getTossRateLimiter(group: TossRateLimitGroup): RateLimiter {
  let limiter = instances.get(group);
  if (!limiter) {
    limiter = new RateLimiter(TOSS_RATE_LIMIT_GROUPS[group], group);
    instances.set(group, limiter);
  }
  return limiter;
}
