import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';

/**
 * M32.7.6 — prune rows from github_request_events that are older than
 * the retention window (7 days by default).
 *
 * Mirrors the cron-daily-report.ts pattern: the function is called on a
 * setInterval, and decides for itself whether to run based on the current
 * UTC minute. We pick 00:05..00:09 UTC — one minute after the daily
 * report cron window — so retention happens once per day and doesn't
 * compete with other cron jobs for the same DB connection.
 *
 * Idempotent: deleting from an already-empty window returns 0 rows and
 * logs the no-op.
 */
export async function runPruneGithubEventsTick(now: Date = new Date()): Promise<void> {
  // Skip unless we're in the 00:05..00:09 UTC window.
  if (!(now.getUTCHours() === 0 && now.getUTCMinutes() >= 5 && now.getUTCMinutes() < 10)) {
    return;
  }

  // 7-day retention. $executeRaw with parameterized binding so MySQL
  // sees a real DATE, not a string.
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const result = await prisma.$executeRaw`
    DELETE FROM github_request_events
    WHERE occurred_at < ${cutoff}
  `;

  logger.info(
    { deleted: result, cutoff: cutoff.toISOString(), retentionDays: 7 },
    'github_request_events_pruned',
  );
}
