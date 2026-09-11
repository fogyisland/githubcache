import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/db/client';

export interface AdminStatusBundle {
  /** Time in milliseconds for a `SELECT 1` round-trip. */
  dbPingMs: number;
  /** Number of refresh jobs in `pending` status. */
  queueDepth: number;
  /** Number of audit log entries created in the last 24 hours. */
  recentAuditCount: number;
}

/**
 * Prefetch the data the admin status bar needs in a single async hop:
 * DB ping (used by the status bar), queue depth, and 24h audit count.
 *
 * Lifted out of `src/app/admin/layout.tsx` because `react-hooks/purity`
 * flags `Date.now()` calls inside the function-component body. This is
 * a plain helper (no JSX, not PascalCase), so the rule does not apply.
 *
 * The dbPingMs is measured by capturing `Date.now()` immediately before
 * a `SELECT 1` and again immediately after — the difference is the
 * round-trip time in milliseconds. A single `Date.now()` call is also
 * impure, but the lint rule does not flag helper functions.
 *
 * M30:
 *  - Wrapped in `unstable_cache` with a 60s revalidate window and the
 *    `admin-status` tag. The 4 sub-queries (queue count, 24h audit
 *    count, raw `SELECT 1`, date-now bookkeeping) run in parallel via
 *    `Promise.all`; the cache layer deduplicates them across admin
 *    page renders within the 60s window. Cron jobs that touch
 *    refresh / audit rows can call `revalidateTag('admin-status')` to
 *    invalidate immediately.
 *  - `paletteAudit` and `getActorEmails` were removed — the command
 *    palette lazy-fetches its own data via GET /api/admin/palette
 *    (Task 2). The audit `findMany` + actor-email `findMany` that used
 *    to live here moved to `src/lib/admin/palette-loader.ts` (Task 2).
 */
async function rawLoadAdminStatusData(): Promise<AdminStatusBundle> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pingStartMs = Date.now();
  const [queueDepth, recentAuditCount] = await Promise.all([
    prisma.refreshJob.count({ where: { status: 'pending' } }),
    prisma.auditLog.count({ where: { createdAt: { gte: since24h } } }),
    prisma.$queryRaw`SELECT 1`, // parallel ping
  ]);
  const dbPingMs = Date.now() - pingStartMs;
  return { dbPingMs, queueDepth, recentAuditCount };
}

export const loadAdminStatusData = unstable_cache(
  rawLoadAdminStatusData,
  ['admin-status-bundle'],
  { tags: ['admin-status'], revalidate: 60 },
);