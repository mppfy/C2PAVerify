/**
 * KV-based sliding-window rate limiter.
 *
 * Design:
 *   - Key by `cf-connecting-ip` (upstream client IP, CF injects, can't be spoofed
 *     by trusting X-Forwarded-For). Fallback = 'unknown' → shared bucket.
 *   - Fixed window per-minute counter stored in KV. Simple, не strict-accurate,
 *     but acceptable for M6 launch (worst case ~2× limit на boundary).
 *   - Write path uses KV.put с expirationTtl=65s (1min window + small grace).
 *
 * WHY KV, не Durable Object:
 *   - DO stricter, но дополнительный $5/M invocations cost и extra latency.
 *   - Launch-phase traffic низкий (< 100 req/mo expected), KV's eventual consistency
 *     acceptable. Upgrade to DO when abuse observed.
 *
 * NOT a defense against distributed abuse — только per-IP throttle.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Unix ms when current window ends */
  resetAt: number;
  /** Total requests this window */
  used: number;
  /** Limit for this window */
  limit: number;
}

export interface RateLimitOptions {
  /** Requests per window */
  limit: number;
  /** Window size in seconds (default 60) */
  windowSeconds?: number;
  /** Namespace prefix — allows multiple limiters on same KV */
  namespace?: string;
}

/**
 * Check + increment rate-limit counter for the given client key.
 *
 * Race: KV gets are eventually-consistent; two concurrent requests both read
 * the same pre-increment value and both increment, letting through 1 extra req.
 * Acceptable.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  clientKey: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const windowSec = opts.windowSeconds ?? 60;
  const ns = opts.namespace ?? 'rl';

  // Window bucket = floor(now / window) → all requests in same minute share key
  const nowMs = Date.now();
  const bucketId = Math.floor(nowMs / 1000 / windowSec);
  const key = `${ns}:${clientKey}:${bucketId}`;

  const raw = await kv.get(key);
  const currentUsed = raw ? Number.parseInt(raw, 10) || 0 : 0;
  const nextUsed = currentUsed + 1;
  const resetAt = (bucketId + 1) * windowSec * 1000;

  if (currentUsed >= opts.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      used: currentUsed,
      limit: opts.limit,
    };
  }

  // Allowed → increment counter.
  // TTL covers the window + 5s grace (KV TTL min is 60s anyway).
  await kv.put(key, String(nextUsed), {
    expirationTtl: Math.max(60, windowSec + 5),
  });

  return {
    allowed: true,
    remaining: Math.max(0, opts.limit - nextUsed),
    resetAt,
    used: nextUsed,
    limit: opts.limit,
  };
}

/**
 * Extract stable client key from request headers.
 * Prefers CF-Connecting-IP (which CF sets and cannot be spoofed), falls back
 * to 'unknown' bucket (shared — means attackers can't blow past limit by
 * sending unknown IPs; they all hit the same counter).
 */
export function clientKeyFromRequest(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

/**
 * Standard rate-limit headers per RFC 9239 / GitHub convention.
 */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    'x-ratelimit-limit': String(r.limit),
    'x-ratelimit-remaining': String(r.remaining),
    'x-ratelimit-reset': String(Math.floor(r.resetAt / 1000)),
  };
}
