/** Default freshness window for cached broker API responses. */
export const DEFAULT_TTL_MS = 5000;

/**
 * 보유종목/예수금/계좌목록/현재 환율용 — 프론트는 화면을 옮길 때마다 페이지가
 * 새로 마운트돼 같은 계좌를 다시 조회하고(App.tsx), 대시보드/보유종목/배당금
 * 화면이 같은 계좌의 포트폴리오를 각자 부른다. 5초 TTL로는 탭을 오가기만 해도
 * 매번 브로커 API를 다시 쳤다. 30초면 그 사이 화면 전환은 캐시로 끝나고,
 * Dashboard.tsx의 60초 자동 갱신은 항상 만료 후라 여전히 새 값을 받는다 —
 * 새로고침 버튼은 forceRefresh로 이 캐시를 건너뛴다.
 */
export const PORTFOLIO_TTL_MS = 30_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

// 만료된 항목은 같은 key로 다시 조회될 때만 덮어써져서, 한 번 쓰고 마는 key
// (기간별 매매내역, 종목 조합별 시세 등)가 프로세스가 사는 동안 계속 쌓였다 —
// 일정 간격으로 만료 항목을 정리한다(Map 순회라 항목 수에 비례, 매 호출마다
// 할 필요는 없음).
const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = Date.now();

function sweepExpired(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

// Tracks a fetcher call that's still in flight per key, so two callers that
// ask for the same key before either has resolved share one real network
// call instead of both firing it — a plain TTL cache (above) doesn't cover
// this, since neither call has anything to read yet. This matters because
// React StrictMode double-invokes effects in dev: the discarded run's
// setState is suppressed, but its request already fired before the
// suppression can happen (see frontend/src/pages/Dashboard.tsx's comment on
// this). Without coalescing, two near-simultaneous requests for the same
// account hit the broker's API concurrently, and some brokers respond to
// that with errors that look unrelated to rate limiting (e.g. Toss's
// /api/v1/holdings has returned "account-not-found" on the loser of such a
// race) rather than a clean 429.
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Caches whatever `fetcher` resolves to under `key` for `ttlMs`, so
 * re-requesting the same broker endpoint within that window (switching
 * dashboard tabs and back, a stray double-render) reuses the last response
 * instead of hitting the broker's API again — some brokers (KIS) rate-limit
 * tightly enough that this matters even under light, single-user usage.
 * Also coalesces concurrent calls for the same key that land before the
 * first one resolves (see `inFlight` above).
 * Pass `forceRefresh: true` (e.g. from the Dashboard's refresh button) to
 * bypass both and always issue a fresh call.
 */
export async function withCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  opts: { forceRefresh?: boolean } = {}
): Promise<T> {
  if (!opts.forceRefresh) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;

    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const promise = (async () => {
    try {
      const value = await fetcher();
      const now = Date.now();
      sweepExpired(now);
      cache.set(key, { value, expiresAt: now + ttlMs });
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
