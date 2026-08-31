import type { Prisma, RefreshJob, Repository } from '@prisma/client';
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

/**
 * List refresh jobs filtered by status, ordered by created_at DESC. Top N only.
 *
 * For `pending`: sorted by `priority ASC, scheduledFor ASC` instead — that's
 * the queue head the scheduler is about to drain.
 *
 * For `in_progress` / `done` / `failed`: sorted by `updatedAt DESC` so the
 * most-recently-active rows appear first.
 *
 * For done/failed, use `listJobsInRange` to bound by a time window instead
 * (terminal states accumulate forever).
 *
 * Used by /admin/queue (M20.7) to render the per-status sections.
 */
export async function listJobsByStatus(
  status: 'pending' | 'in_progress' | 'done' | 'failed',
  limit: number,
): Promise<Array<RefreshJob & { repository: Repository }>> {
  const orderBy: Prisma.RefreshJobOrderByWithRelationInput | Prisma.RefreshJobOrderByWithRelationInput[] =
    status === 'pending'
      ? [{ priority: 'asc' }, { scheduledFor: 'asc' }]
      : { updatedAt: 'desc' };
  return prisma.refreshJob.findMany({
    where: { status },
    orderBy,
    take: limit,
    include: { repository: true },
  });
}

/**
 * List refresh jobs in a terminal status (`done` | `failed`) inside a time
 * window. Ordered by `updatedAt DESC` so the most-recently-completed row
 * comes first.
 *
 * Used by /admin/queue (M20.7) to render the done 24h / failed 24h sections.
 */
export async function listJobsInRange(
  status: 'done' | 'failed',
  from: Date,
  to: Date,
  limit: number,
): Promise<Array<RefreshJob & { repository: Repository }>> {
  return prisma.refreshJob.findMany({
    where: { status, updatedAt: { gte: from, lt: to } },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: { repository: true },
  });
}

/**
 * Get the scheduledFor of the oldest pending refresh job, or null if the
 * pending queue is empty.
 *
 * Used by /admin/queue (M20.7) to surface the "oldest pending age" KPI so
 * the admin can tell at a glance whether the queue is keeping up.
 */
export async function getOldestPending(): Promise<Date | null> {
  const row = await prisma.refreshJob.findFirst({
    where: { status: 'pending' },
    orderBy: { scheduledFor: 'asc' },
    select: { scheduledFor: true },
  });
  return row?.scheduledFor ?? null;
}
