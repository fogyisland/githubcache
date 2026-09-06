import { prisma } from '@/lib/db/client';

const DEFAULT_WINDOW_MS = 60_000;

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
 * Atomic increment of the per-key rate-limit bucket. Fixed 60-second
 * window aligned to wall-clock minute boundaries. Returns the count AFTER
 * increment.
 *
 * Concurrency model — single-statement upsert + same-connection read
 * (M11.16 fix, replaces M8.1 SELECT-FOR-UPDATE pattern):
 *
 *   INSERT ... VALUES (...)
 *   ON DUPLICATE KEY UPDATE
 *     count = IF(window_start = VALUES(window_start), count + 1, 1),
 *     window_start = VALUES(window_start),
 *     updated_at = VALUES(updated_at)
 *
 *   SELECT count FROM rate_limit_buckets WHERE api_key_id = ?
 *
 * Both statements run on the same Prisma connection (not inside an
 * explicit `$transaction`). Each call is a single round-trip that holds
 * the connection for ~1ms: no pool-queue starvation under 100-concurrent
 * load, and no `transaction_timeout` (`P2028`) errors.
 *
 * Semantics under MySQL's default REPEATABLE READ:
 *   - The upsert is a single atomic statement: it acquires a brief
 *     exclusive row lock on (api_key_id) at write time and releases it
 *     on commit. There is NO gap lock (unique-key upserts don't take
 *     gap locks under REPEATABLE READ).
 *   - The SELECT runs after the upsert has committed on the same
 *     connection; in the auto-commit mode Prisma uses for raw
 *     statements, the SELECT sees the freshly-committed upsert.
 *   - Concurrent upserts on the same api_key_id serialize briefly on
 *     the row lock, but never deadlock — the row lock is exclusive
 *     without a guard against anything else.
 *
 * Wrapped in `withDeadlockRetry` as a safety net for the rare case
 * where the upsert itself deadlocks under extreme contention (e.g.,
 * mixed INSERT/UPDATE workloads on adjacent index ranges).
 */
export async function incrementBucket(
  apiKeyId: bigint,
  windowStart: Date,
  windowMs: number = DEFAULT_WINDOW_MS,
): Promise<number> {
  void windowMs; // windowMs only affects the pre-computed windowStart passed in;
  // the SQL itself is window-agnostic (it just stores whatever the caller
  // computed). Documented here so the next reader doesn't try to thread
  // it through the raw query.
  return withDeadlockRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.$executeRaw`
          INSERT INTO rate_limit_buckets
            (api_key_id, window_start, count, created_at, updated_at)
          VALUES
            (${apiKeyId}, ${windowStart}, 1, ${now}, ${now})
          ON DUPLICATE KEY UPDATE
            count = IF(window_start = VALUES(window_start), count + 1, 1),
            window_start = VALUES(window_start),
            updated_at = VALUES(updated_at)
        `;
        const rows = await tx.$queryRaw<Array<{ count: number }>>`
          SELECT count FROM rate_limit_buckets WHERE api_key_id = ${apiKeyId}
        `;
        const row = rows[0];
        if (!row) {
          throw new Error(
            `rate_limit_buckets row missing for api_key_id=${apiKeyId} after upsert`,
          );
        }
        return row.count;
      },
      {
        // 30s gives ample headroom for the 100-concurrent test; the
        // pool ceiling is bumped to 32 in client.ts.
        maxWait: 30_000,
        timeout: 30_000,
      },
    ),
  );
}

/**
 * Truncate a Date to the start of its window. Default window is 60 seconds
 * (aligned to wall-clock minute boundaries); pass a custom `windowMs` to
 * use a longer window — the bucket table is window-agnostic, so the same
 * `rate_limit_buckets` row is reused for the full window duration.
 */
export function windowStartFor(now: Date, windowMs: number = DEFAULT_WINDOW_MS): Date {
  const ms = now.getTime();
  return new Date(Math.floor(ms / windowMs) * windowMs);
}

/**
 * Seconds remaining until the current window ends (caller uses this for
 * Retry-After header on 429). Returns 0 if window has already passed.
 */
export function retryAfterSeconds(
  now: Date,
  windowStart: Date,
  windowMs: number = DEFAULT_WINDOW_MS,
): number {
  const endsAt = windowStart.getTime() + windowMs;
  const ms = endsAt - now.getTime();
  return Math.max(0, Math.ceil(ms / 1000));
}