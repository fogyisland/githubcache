import { prisma } from '@/lib/db/client';
import { windowStartFor, retryAfterSeconds } from '@/lib/db/rate-limit';

/**
 * Atomic increment of the per-IP rate-limit bucket. Same semantics as
 * incrementBucket (M8.1) but keyed by client IP instead of apiKeyId. Used
 * by the public lookup form where callers do not bring an X-API-Key.
 *
 * Fixed 60-second window aligned to wall-clock minute boundaries. Returns
 * the count AFTER increment.
 *
 * Uses SELECT ... FOR UPDATE inside a prisma.$transaction so concurrent
 * requests from the same IP are serialized per row. Works on MySQL 5.7+
 * (no SKIP LOCKED).
 */
export async function incrementIpBucket(ip: string, windowStart: Date): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ count: number; window_start: Date }>>`
      SELECT count, window_start
      FROM ip_rate_limit_buckets
      WHERE ip = ${ip}
      FOR UPDATE
    `;
    const existing = rows[0];
    if (!existing) {
      // First request from this IP — insert and return count=1
      const now = new Date();
      await tx.$executeRaw`
        INSERT INTO ip_rate_limit_buckets (ip, window_start, count, created_at, updated_at)
        VALUES (${ip}, ${windowStart}, 1, ${now}, ${now})
      `;
      return 1;
    }
    const now = new Date();
    if (existing.window_start.getTime() === windowStart.getTime()) {
      // Same window — increment
      await tx.$executeRaw`
        UPDATE ip_rate_limit_buckets
        SET count = count + 1, updated_at = ${now}
        WHERE ip = ${ip}
      `;
      return existing.count + 1;
    }
    // New window — reset count to 1 and update window_start
    await tx.$executeRaw`
      UPDATE ip_rate_limit_buckets
      SET count = 1, window_start = ${windowStart}, updated_at = ${now}
      WHERE ip = ${ip}
    `;
    return 1;
  });
}

/**
 * Convenience wrapper used by callers that want both the increment and the
 * windowStart derivation. Kept here to avoid forcing every caller to import
 * windowStartFor from the api-key file.
 */
export async function checkIpBucketRaw(
  ip: string,
  now: Date = new Date(),
): Promise<{ count: number; windowStart: Date }> {
  const windowStart = windowStartFor(now);
  const count = await incrementIpBucket(ip, windowStart);
  return { count, windowStart };
}

// Re-export so callers do not need to import from the api-key module.
export { windowStartFor, retryAfterSeconds };
