import type { RefreshJob, Repository } from '@prisma/client';
import { prisma } from '@/lib/db/client';

const MANUAL_REFRESH_PRIORITY = 10; // outranks default 50 — high priority for admin triggers

/**
 * Enqueue a manual refresh job for a specific repository. Returns the new
 * job. Does NOT immediately run the job — the scheduler tick (next
 * interval) will claim and process it via `claimBatch`.
 *
 * Priority is 10 (outranks default 50). scheduledFor = now (immediate).
 * Status defaults to 'pending'; attempts starts at 0.
 *
 * Used by /api/admin/refresh (action=trigger).
 */
export async function enqueueManualRefresh(repositoryId: bigint): Promise<RefreshJob> {
  return prisma.refreshJob.create({
    data: {
      repositoryId,
      priority: MANUAL_REFRESH_PRIORITY,
      scheduledFor: new Date(),
      status: 'pending',
      attempts: 0,
      lockedUntil: null,
      lastError: null,
    },
  });
}

/**
 * List pending refresh jobs (not yet claimed), ordered by priority ASC then
 * scheduled_for ASC. Top N only.
 *
 * Used by /admin/refresh to render the pending-jobs table (top 20).
 */
export async function listPendingJobs(
  limit: number,
): Promise<Array<RefreshJob & { repository: Repository }>> {
  return prisma.refreshJob.findMany({
    where: { status: 'pending' },
    orderBy: [{ priority: 'asc' }, { scheduledFor: 'asc' }],
    take: limit,
    include: { repository: true },
  });
}

/**
 * List repositories for the repo picker dropdown. Top N ordered by id ASC.
 * Minimal projection (id, owner, name) to keep payload small.
 */
export async function listRepositoriesForPicker(
  limit: number,
): Promise<Array<{ id: bigint; owner: string; name: string }>> {
  return prisma.repository.findMany({
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, owner: true, name: true },
  });
}
