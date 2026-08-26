import { prisma } from '@/lib/db/client';
import { windowStartFor, retryAfterSeconds } from '@/lib/db/rate-limit';

/** Detect MySQL Error 1213 (deadlock) on a thrown error. */
function isDeadlock(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const meta = (e as { meta?: { code?: string; message?: string } }).meta;
  if (!meta) return false;
  return meta.code === '1213' || String(meta.message ?? '').includes('Deadlock');
}

async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      if (!isDeadlock(e) || attempt === maxAttempts) {
        throw e;
      }
      lastErr = e;
      const ms = Math.floor(Math.random() * 20 * attempt);
      await new Promise((r) => setTimeout(r, ms));
    }
  }
  throw lastErr;
}

/**
 * Atomic increment of the per-IP rate-limit bucket. See incrementBucket
 * (rate-limit.ts) for the full single-statement-upsert + same-connection
 * read concurrency model.
 */
export async function incrementIpBucket(ip: string, windowStart: Date): Promise<number> {
  return withDeadlockRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.$executeRaw`
          INSERT INTO ip_rate_limit_buckets
            (ip, window_start, count, created_at, updated_at)
          VALUES
            (${ip}, ${windowStart}, 1, ${now}, ${now})
          ON DUPLICATE KEY UPDATE
            count = IF(window_start = VALUES(window_start), count + 1, 1),
            window_start = VALUES(window_start),
            updated_at = VALUES(updated_at)
        `;
        const rows = await tx.$queryRaw<Array<{ count: number }>>`
          SELECT count FROM ip_rate_limit_buckets WHERE ip = ${ip}
        `;
        const row = rows[0];
        if (!row) {
          throw new Error(
            `ip_rate_limit_buckets row missing for ip=${ip} after upsert`,
          );
        }
        return row.count;
      },
      {
        maxWait: 30_000,
        timeout: 30_000,
      },
    ),
  );
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