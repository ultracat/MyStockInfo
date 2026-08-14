function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryableResponse {
  status: number;
  headers: { get(name: string): string | null };
}

export interface PeakWindow {
  /** KST hour/minute the reduced rate starts (inclusive). */
  startHourKst: number;
  startMinuteKst: number;
  /** KST hour/minute the reduced rate ends (exclusive). */
  endHourKst: number;
  endMinuteKst: number;
  tps: number;
}

export interface RateLimitGroupConfig {
  /** Documented requests-per-second outside any peak window. */
  tps: number;
  peak?: PeakWindow;
}

function isWithinPeakWindowKst(peak: PeakWindow): boolean {
  const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const minutesNow = kstNow.getHours() * 60 + kstNow.getMinutes();
  const start = peak.startHourKst * 60 + peak.startMinuteKst;
  const end = peak.endHourKst * 60 + peak.endMinuteKst;
  return minutesNow >= start && minutesNow < end;
}

function documentedTps(config: RateLimitGroupConfig): number {
  if (config.peak && isWithinPeakWindowKst(config.peak)) return config.peak.tps;
  return config.tps;
}

/**
 * Serializes calls to at most one per interval, for one rate-limit group
 * (each broker's Open API tends to limit per client × per endpoint-group
 * TPS — create one instance per group).
 *
 * Falls back to the documented `config` (peak-window aware) whenever we
 * haven't yet learned — or didn't receive — real `X-RateLimit-*` headers,
 * and self-calibrates from those headers via `learnFromHeaders` once
 * responses start arriving, so a response never goes unaccounted for even
 * on the very first call or after a network failure.
 */
export class RateLimiter {
  private learnedIntervalMs: number | null = null;
  private nextAvailableAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly config: RateLimitGroupConfig, private readonly label: string) {}

  private currentIntervalMs(): number {
    return this.learnedIntervalMs ?? Math.ceil(1000 / documentedTps(this.config));
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const turn = this.chain.then(async () => {
      const wait = this.nextAvailableAt - Date.now();
      if (wait > 0) await sleep(wait);
      this.nextAvailableAt = Date.now() + this.currentIntervalMs();
    });
    this.chain = turn;
    return turn.then(fn);
  }

  /**
   * Pushes the next scheduled call out to at least `untilMs` — for brokers
   * whose rate-limit signal isn't a response header (KIS reports it as a
   * body error code, `EGW00201`), so a caller that catches that error can
   * still slow down every *future* call through this limiter, not just
   * retry the one that failed. Same intent as learnFromHeaders' low-water
   * mark push, just fed by an out-of-band signal instead of headers.
   */
  penalizeUntil(untilMs: number): void {
    this.nextAvailableAt = Math.max(this.nextAvailableAt, untilMs);
  }

  /**
   * Reads `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`
   * — present on both success and 429 responses — and adjusts pacing:
   *  - `Limit` recalibrates our steady-state interval to the server's
   *    actual allotted rate instead of the documented default.
   *  - A low (or zero) `Remaining` pushes the next request out to `Reset`
   *    seconds from now, easing off preemptively as the bucket drains
   *    rather than waiting until we're actually rejected with a 429.
   * Call this on every response you get back, success or 429.
   */
  learnFromHeaders(res: RetryableResponse): void {
    const limit = Number(res.headers.get('X-RateLimit-Limit'));
    if (Number.isFinite(limit) && limit > 0) {
      const learned = Math.ceil(1000 / limit);
      if (learned !== this.learnedIntervalMs) {
        console.log(`[rate-limit:${this.label}] server reports ${limit} req/s — pacing at ${learned}ms/req`);
        this.learnedIntervalMs = learned;
      }
    }

    const remaining = Number(res.headers.get('X-RateLimit-Remaining'));
    const resetSec = Number(res.headers.get('X-RateLimit-Reset'));
    if (Number.isFinite(remaining) && Number.isFinite(resetSec) && resetSec > 0) {
      const effectiveLimit = Number.isFinite(limit) && limit > 0 ? limit : 1000 / this.currentIntervalMs();
      // "Low water mark": once remaining tokens drop to roughly a third of
      // burst capacity (min 1), start honoring the server's own countdown
      // instead of our steady-state guess — this also covers exhaustion we
      // didn't cause ourselves (e.g. another process sharing this client).
      const lowWaterMark = Math.max(1, Math.ceil(effectiveLimit / 3));
      if (remaining <= lowWaterMark) {
        this.nextAvailableAt = Math.max(this.nextAvailableAt, Date.now() + resetSec * 1000);
      }
    }
  }
}

/**
 * Retries `attempt` while it resolves with a 429, honoring `Retry-After`
 * when present and otherwise backing off exponentially (1s, 2s, 4s, ...)
 * with jitter — matching developers.tossinvest.com/docs' documented client
 * behavior for `rate-limit-exceeded` / `edge-rate-limit-exceeded`.
 * `onResponse` fires for every attempt (so a RateLimiter can learn from
 * each one's headers, including 429s).
 */
export async function withRateLimitRetry<T extends RetryableResponse>(
  attempt: () => Promise<T>,
  onResponse: (res: T) => void = () => {},
  maxAttempts = 4
): Promise<T> {
  for (let n = 0; ; n++) {
    const res = await attempt();
    onResponse(res);
    if (res.status !== 429 || n >= maxAttempts - 1) return res;

    const retryAfterSec = Number(res.headers.get('Retry-After'));
    const backoffMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 2 ** n * 1000;
    const jitterMs = Math.random() * 250;
    await sleep(backoffMs + jitterMs);
  }
}
