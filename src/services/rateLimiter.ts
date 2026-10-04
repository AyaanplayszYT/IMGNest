/**
 * In-memory rate limiter for the /api/images/fetch endpoint.
 * Uses a sliding-window counter keyed by IP address.
 * No external dependencies — safe for low-memory environments.
 */

interface Bucket {
  count: number;
  resetAt: number; // epoch ms
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs: number;
  private readonly max: number;

  /**
   * @param windowMs  Duration of the window in milliseconds (e.g. 10_000 for 10 s)
   * @param max       Maximum requests allowed within the window
   */
  constructor(windowMs: number, max: number) {
    this.windowMs = windowMs;
    this.max = max;
  }

  /**
   * Try to consume one token for the given key.
   * Returns `{ allowed: true }` when the request is within limits,
   * or `{ allowed: false, retryAfterMs }` when the limit has been hit.
   */
  consume(key: string): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    // Create or reset an expired bucket
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    if (bucket.count >= this.max) {
      return { allowed: false, retryAfterMs: bucket.resetAt - now };
    }

    bucket.count += 1;
    return { allowed: true };
  }

  /** Prune stale entries to prevent unbounded memory growth. Call periodically. */
  prune(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}
