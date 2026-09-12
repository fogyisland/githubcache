import type { RefreshJob } from '@prisma/client';
import { prisma } from '@/lib/db/client';

const LOCK_DURATION_MS = 5 * 60_000; // 5 minutes — matches M5.4's expected refresh duration

/**
 * Claims up to `batchSize` pending refresh jobs in priority order.
 *
 * Selection criteria:
 * - status = 'pending'
 * - scheduled_for <= now
 * - locked_until IS NULL OR locked_until < now (lease expired or never locked)
 *
 * Uses `FOR UPDATE` to acquire row locks within the transaction.
 *
 * NOTE — MySQL 5.7 workaround:
 * The design spec mandates `FOR UPDATE SKIP LOCKED` (MySQL 8.0+ only). Live DB
 * is MySQL 5.7.44 which doesn't support SKIP LOCKED. Since M5's design is a
 * single in-process worker (per M5.5's startScheduler), concurrent workers
 * are not a concern — `FOR UPDATE` (no SKIP LOCKED) is safe for the single-
 * worker case. When MySQL is upgraded to 8.0+ (or multi-worker scaling is
 * needed), re-introduce `SKIP LOCKED` here.
 *
 * NOTE — Time comparison:
 * `DATETIME` columns round-trip as UTC correctly (tz-agnostic storage),
 * but the server's session tz is Beijing, so `NOW()` returns local wall-
 * clock 8h ahead of stored UTC values. Use `UTC_TIMESTAMP(6)` for all
 * current-time comparisons. Precision 6 because bare `UTC_TIMESTAMP()`
 * truncates to seconds (would miss jobs scheduled at `new Date()` within
 * the same second).
 *
 * Each claimed job is marked:
 * - status: 'in_progress'
 * - lockedUntil: now + LOCK_DURATION_MS
 * - attempts: incremented
 *
 * Returns the claimed jobs (without joining Repository — callers look up the
 * Repository by owner/name via findRepoByCanonical).
 */
export async function claimBatch(batchSize: number): Promise<RefreshJob[]> {
  return prisma.$transaction(async (tx) => {
    // M31.1 — drop `repository_id` from the SELECT list. M31 made
    // repository_id nullable (and dropped the FK to repositories), so
    // the value is no longer authoritative for scheduler dispatch —
    // refresh-one.ts looks the row up by owner/name instead. The
    // column itself is kept on the table for legacy compatibility
    // (audit / back-office consumers may still reference it), but
    // the claim path doesn't need it. Trimming the projection saves
    // a small amount of wire traffic and makes the SELECT's intent
    // explicit: "give me the ids I'm about to lock".
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM refresh_jobs
      WHERE status = 'pending'
        AND scheduled_for <= UTC_TIMESTAMP(6)
        AND (locked_until IS NULL OR locked_until < UTC_TIMESTAMP(6))
      ORDER BY priority ASC, scheduled_for ASC
      LIMIT ${batchSize}
      FOR UPDATE
    `;

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];

    await tx.refreshJob.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'in_progress',
        lockedUntil: new Date(Date.now() + LOCK_DURATION_MS),
        attempts: { increment: 1 },
      },
    });

    return tx.refreshJob.findMany({
      where: { id: { in: ids } },
      orderBy: [{ priority: 'asc' }, { scheduledFor: 'asc' }],
    });
  });
}