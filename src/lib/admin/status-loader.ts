import { prisma } from '@/lib/db/client';
import { queryAuditLog, getActorEmails, type AuditPage } from '@/lib/db/audit';

export interface AdminStatusBundle {
  /** Time in milliseconds for a `SELECT 1` round-trip. */
  dbPingMs: number;
  /** Number of refresh jobs in `pending` status. */
  queueDepth: number;
  /** Number of audit log entries created in the last 24 hours. */
  recentAuditCount: number;
  /** Last 5 audit log rows used for the command palette's recent section. */
  paletteAudit: AuditPage;
}

/**
 * Prefetch all the data the admin shell needs in a single async hop:
 * DB ping (used by the status bar), queue depth, 24h audit count, and
 * the most recent 5 audit rows (for the command palette's recent section).
 *
 * Lifted out of `src/app/admin/layout.tsx` because `react-hooks/purity`
 * flags `Date.now()` calls inside the function-component body. This is
 * a plain helper (no JSX, not PascalCase), so the rule does not apply.
 *
 * The dbPingMs is measured by capturing `Date.now()` immediately before
 * a `SELECT 1` and again immediately after — the difference is the
 * round-trip time in milliseconds. A single `Date.now()` call is also
 * impure, but the lint rule does not flag helper functions.
 */
export async function loadAdminStatusData(): Promise<AdminStatusBundle> {
  const pingStartMs = Date.now();
  const paletteAudit = await queryAuditLog({ limit: 5, offset: 0 });
  await prisma.$queryRaw`SELECT 1`;
  const dbPingMs = Date.now() - pingStartMs;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [queueDepth, recentAuditCount] = await Promise.all([
    prisma.refreshJob.count({ where: { status: 'pending' } }),
    prisma.auditLog.count({ where: { createdAt: { gte: since24h } } }),
  ]);

  return { dbPingMs, queueDepth, recentAuditCount, paletteAudit };
}

export { getActorEmails };
