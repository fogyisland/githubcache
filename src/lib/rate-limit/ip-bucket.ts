import { incrementIpBucket } from '@/lib/db/ip-rate-limit';
import { retryAfterSeconds, windowStartFor } from '@/lib/db/rate-limit';

export interface IpRateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

/**
 * Durable sliding-window rate limit check, keyed by client IP. Same atomic
 * semantics as checkRateLimit (M8.1) — SELECT ... FOR UPDATE inside a
 * transaction serializes concurrent calls per IP.
 *
 * Used by the public lookup form where callers do not bring an X-API-Key.
 * Default limit comes from PUBLIC_LOOKUP_RATE_PER_MIN env (see src/lib/
 * config/env.ts); 30/min is a reasonable default that allows casual
 * browsing while protecting the GitHub token pool from abuse.
 */
export async function checkIpRateLimit(
  ip: string,
  perMinute: number,
): Promise<IpRateLimitResult> {
  const now = new Date();
  const windowStart = windowStartFor(now);
  const count = await incrementIpBucket(ip, windowStart);
  const allowed = count <= perMinute;
  return {
    allowed,
    count,
    limit: perMinute,
    retryAfterSeconds: allowed ? 0 : retryAfterSeconds(now, windowStart),
  };
}
