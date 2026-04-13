/**
 * Simple in-memory sliding-window rate limiter keyed by IP.
 *
 * Not cluster-safe (single-instance deployment only). For Railway's
 * default single-replica setup this is fine.
 */

const buckets = new Map<string, number[]>();

/**
 * Check if a request from `ip` is allowed under `max` per `windowMs` ms.
 * Returns true if allowed (and records the hit), false if over-limit.
 */
export function checkRateLimit(ip: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const bucket = (buckets.get(ip) || []).filter((t) => t > cutoff);
  if (bucket.length >= max) {
    buckets.set(ip, bucket);
    return false;
  }
  bucket.push(now);
  buckets.set(ip, bucket);
  return true;
}

/** Read-only inspection for tests / debugging. */
export function getBucketSize(ip: string): number {
  return (buckets.get(ip) || []).length;
}

/** Testing helper: clear all buckets. */
export function clearRateLimits(): void {
  buckets.clear();
}
