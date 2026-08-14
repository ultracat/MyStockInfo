/** Default freshness window for cached broker API responses. */
export const DEFAULT_TTL_MS = 5000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

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
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
