import { prisma } from '@/lib/db/client';

const WINDOW_MS = 60_000;

/**
 * Atomic increment of the per-key rate-limit bucket. Fixed 60-second window
 * aligned to wall-clock minute boundaries. Returns the count AFTER increment
 * (so caller can decide if request is allowed).
 *
 * Uses a transaction with SELECT ... FOR UPDATE so concurrent calls are
 * serialized per row — exactly `total` increments return a final count
 * matching the number of calls. Works on MySQL 5.7+ (no SKIP LOCKED).
 */
export async function incrementBucket(
  apiKeyId: bigint,
  windowStart: Date,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    // SELECT FOR UPDATE acquires a row lock; concurrent transactions for
    // the same apiKeyId wait here, then read the latest committed count.
    const rows = await tx.$queryRaw<Array<{ count: number; window_start: Date }>>`
      SELECT count, window_start
      FROM rate_limit_buckets
      WHERE api_key_id = ${apiKeyId}
      FOR UPDATE
    `;
    const existing = rows[0];
    if (!existing) {
      // First request for this key — insert and return count=1
      const now = new Date();
      await tx.$executeRaw`
        INSERT INTO rate_limit_buckets (api_key_id, window_start, count, created_at, updated_at)
        VALUES (${apiKeyId}, ${windowStart}, 1, ${now}, ${now})
      `;
      return 1;
    }
    const now = new Date();
    if (existing.window_start.getTime() === windowStart.getTime()) {
      // Same window — increment
      await tx.$executeRaw`
        UPDATE rate_limit_buckets
        SET count = count + 1, updated_at = ${now}
        WHERE api_key_id = ${apiKeyId}
      `;
      return existing.count + 1;
    }
    // New window — reset count to 1 and update window_start
    await tx.$executeRaw`
      UPDATE rate_limit_buckets
      SET count = 1, window_start = ${windowStart}, updated_at = ${now}
      WHERE api_key_id = ${apiKeyId}
    `;
    return 1;
  });
}

/**
 * Truncate a Date to the start of its wall-clock minute. Used for window
 * alignment. Returns a new Date.
 */
export function windowStartFor(now: Date): Date {
  const ms = now.getTime();
  return new Date(Math.floor(ms / WINDOW_MS) * WINDOW_MS);
}

/**
 * Seconds remaining until the current window ends (caller uses this for
 * Retry-After header on 429). Returns 0 if window has already passed.
 */
export function retryAfterSeconds(now: Date, windowStart: Date): number {
  const endsAt = windowStart.getTime() + WINDOW_MS;
  const ms = endsAt - now.getTime();
  return Math.max(0, Math.ceil(ms / 1000));
}
