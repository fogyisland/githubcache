import { incrementBucket, windowStartFor, retryAfterSeconds } from '@/lib/db/rate-limit';

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
 */
export async function checkRateLimit(
  apiKeyId: bigint,
  perMinute: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const windowStart = windowStartFor(now);
  const count = await incrementBucket(apiKeyId, windowStart);
  const allowed = count <= perMinute;
  return {
    allowed,
    count,
    limit: perMinute,
    retryAfterSeconds: allowed ? 0 : retryAfterSeconds(now, windowStart),
  };
}
