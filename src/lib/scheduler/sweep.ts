import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';

export interface SweepResult {
  reposFound: number;
  jobsCreated: number;
}

/**
 * Nightly sweep: enqueue a refresh for every repo with fetchStatus='ok'.
 *
 * This forces a re-check of every known-good repo at least once per day,
 * catching silent staleness (e.g., a repo was deleted/renamed on GitHub
 * between regular refreshes).
 *
 * Repos with fetchStatus='not_found', 'forbidden', or 'error' are NOT
 * included — they have their own recovery paths via failure escalation.
 *
 * Priority semantics: spec §6.5 uses `priority` with LOWER=more urgent.
 * claimBatch does `ORDER BY priority ASC`. The nightly sweep creates jobs
 * at priority=99 so they are claimed AFTER higher-priority jobs (e.g.,
 * user-triggered refreshes). This is intentional — nightly sweep is bulk
 * maintenance, not urgent.
 *
 * No dedup: calling nightlySweep twice creates duplicate jobs. Sweep
 * runs at most once per day (default 24h interval) so duplicates are
 * not a practical concern. If dedup is needed later, add a UNIQUE
 * constraint on (repositoryId, status='pending') or check before insert.
 */
export async function nightlySweep(): Promise<SweepResult> {
  const repos = await prisma.repository.findMany({
    where: { fetchStatus: 'ok' },
    select: { id: true },
  });

  if (repos.length === 0) {
    logger.info({ reposFound: 0, jobsCreated: 0 }, 'sweep complete (no repos)');
    return { reposFound: 0, jobsCreated: 0 };
  }

  const data = repos.map((r) => ({
    repositoryId: r.id,
    priority: 99,
    scheduledFor: new Date(),
  }));

  const result = await prisma.refreshJob.createMany({ data });
  logger.info(
    { reposFound: repos.length, jobsCreated: result.count },
    'sweep complete',
  );
  return { reposFound: repos.length, jobsCreated: result.count };
}
