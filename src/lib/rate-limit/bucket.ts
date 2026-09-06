import {
  incrementBucket,
  windowStartFor,
  retryAfterSeconds,
} from '@/lib/db/rate-limit';

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

/**
 * Durable sliding-window rate limit check. Atomic via MySQL upsert.
 * Returns whether the request is allowed and metadata for the 429 response.
 *
 * Spec §10.4 + Plan M8.1: replaces the in-memory `tokenBucket` which broke
 * under multi-process deployment.
 *
 * `windowMs` defaults to 60_000 (one minute). Pass a larger window for
 * hourly limits — the bucket table is window-agnostic, so the same row
 * is reused for the full window duration.
 */
export async function checkRateLimit(
  apiKeyId: bigint,
  limit: number,
  windowMs: number = 60_000,
): Promise<RateLimitResult> {
  const now = new Date();
  const windowStart = windowStartFor(now, windowMs);
  const count = await incrementBucket(apiKeyId, windowStart, windowMs);
  const allowed = count <= limit;
  return {
    allowed,
    count,
    limit,
    retryAfterSeconds: allowed ? 0 : retryAfterSeconds(now, windowStart, windowMs),
  };
}

/**
 * Convenience wrapper for the M26.x `/api/v1/repos/[owner]/[name]`
 * endpoint: per-API-key 50_000/hour. Reuses the same durable bucket as
 * the per-minute limit (just with a longer window).
 */
export function checkApiKeyHourlyLimit(
  apiKeyId: bigint,
  perHour: number,
): Promise<RateLimitResult> {
  return checkRateLimit(apiKeyId, perHour, ONE_HOUR_MS);
}
