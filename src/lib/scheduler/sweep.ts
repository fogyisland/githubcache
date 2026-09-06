import { prisma } from '@/lib/db/client';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/logger';

export interface SweepResult {
  reposFound: number;
  jobsCreated: number;
}

/**
 * M27.5 — three per-facet sweeps, each with its own cadence. A sweep
 * only enqueues a job for a repo whose per-facet freshness timestamp
 * is older than the cadence. Repos with fetchStatus='not_found' /
 * 'forbidden' / 'error' are excluded — they have their own recovery
 * paths via failure escalation.
 *
 * Cadence defaults (env-tunable via `src/lib/config/env.ts`):
 *   - core:     168h (7d)  — the full /repos/{o}/{n} re-fetch
 *   - releases:  24h        — /releases only
 *   - branches:  24h        — /branches only
 *
 * Priority semantics: spec §6.5 uses `priority` with LOWER=more urgent.
 * claimBatch does `ORDER BY priority ASC`. The sweeps create jobs at
 * priority=99 so they are claimed AFTER higher-priority jobs (e.g.,
 * user-triggered refreshes).
 *
 * No dedup: calling a sweep twice creates duplicate jobs. Sweeps run
 * at most once per cadence period so duplicates are not a practical
 * concern.
 */
type Facet = 'core' | 'releases' | 'branches';

export async function coreSweep(): Promise<SweepResult> {
  return sweepFacet('core', env.SCHEDULER_CORE_SWEEP_HOURS);
}

export async function releasesSweep(): Promise<SweepResult> {
  return sweepFacet('releases', env.SCHEDULER_RELEASES_SWEEP_HOURS);
}

export async function branchesSweep(): Promise<SweepResult> {
  return sweepFacet('branches', env.SCHEDULER_BRANCHES_SWEEP_HOURS);
}

async function sweepFacet(facet: Facet, cadenceHours: number): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - cadenceHours * 3_600_000);
  const where: {
    fetchStatus: 'ok';
    lastFetchedAt?: { lt: Date };
    releasesFetchedAt?: { lt: Date };
    branchesFetchedAt?: { lt: Date };
  } = { fetchStatus: 'ok' };
  // core: lastFetchedAt is the master timestamp. releases/branches
  // have their own columns (NULL = never fetched, so always stale).
  if (facet === 'core') where.lastFetchedAt = { lt: cutoff };
  if (facet === 'releases') where.releasesFetchedAt = { lt: cutoff };
  if (facet === 'branches') where.branchesFetchedAt = { lt: cutoff };

  const repos = await prisma.repository.findMany({ where, select: { id: true } });

  if (repos.length === 0) {
    logger.info(
      { facet, reposFound: 0, jobsCreated: 0 },
      'sweep complete (no stale repos)',
    );
    return { reposFound: 0, jobsCreated: 0 };
  }

  const data = repos.map((r) => ({
    repositoryId: r.id,
    kind: facet,
    priority: 99,
    scheduledFor: new Date(),
  }));

  const result = await prisma.refreshJob.createMany({ data });
  logger.info(
    { facet, cadenceHours, reposFound: repos.length, jobsCreated: result.count },
    'sweep complete',
  );
  return { reposFound: repos.length, jobsCreated: result.count };
}

// -----------------------------------------------------------------------------
// Backwards-compat shim: existing callers / imports reference `nightlySweep`.
// Re-export under the new name so the legacy import still works while we
// transition. M27.6 cleanup removes this alias.
// -----------------------------------------------------------------------------
export const nightlySweep = coreSweep;
