import { claimBatch } from '@/lib/scheduler/lease';
import { refreshOne, type RefreshJobResult } from '@/lib/jobs/refresh-one';
import { prisma } from '@/lib/db/client';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/logger';

export interface TickResult {
  claimed: number;
  done: number;
  pending: number;
  failed: number;
}

/**
 * One scheduler tick: claim a batch of pending jobs and process them concurrently.
 *
 * Each claimed job is passed to refreshOne, which handles all status transitions
 * internally (including failure escalation). runTick only logs the aggregate result.
 *
 * NOTE: refreshOne returns a RefreshJobResult and does NOT throw on expected
 * errors (404, 403, 429, etc.). The try/catch here is for unexpected errors
 * (DB failures, programmer errors).
 */
export async function runTick(): Promise<TickResult> {
  const jobs = await claimBatch(env.SCHEDULER_BATCH_SIZE);
  if (jobs.length === 0) {
    return { claimed: 0, done: 0, pending: 0, failed: 0 };
  }

  const results = await Promise.all(
    jobs.map(async (job): Promise<RefreshJobResult> => {
      try {
        return await refreshOne(job);
      } catch (e: unknown) {
        // Unexpected error (DB failure, programmer error). Log and mark as failed.
        const message = e instanceof Error ? e.message : String(e);
        logger.error(
          { err: e, jobId: job.id.toString(), repoId: job.repositoryId.toString() },
          'refreshOne threw unexpectedly',
        );
        await prisma.refreshJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            lockedUntil: null,
            lastError: message,
          },
        }).catch(() => {
          // If even the failure-mark fails, log and move on. The job will time out
          // via its lease and the scheduler will reclaim it.
          logger.error({ jobId: job.id.toString() }, 'failed to mark job failed');
        });
        return { status: 'failed', error: message };
      }
    }),
  );

  const summary: TickResult = {
    claimed: jobs.length,
    done: 0,
    pending: 0,
    failed: 0,
  };
  for (const r of results) {
    if (r.status === 'done') summary.done += 1;
    else if (r.status === 'pending') summary.pending += 1;
    else summary.failed += 1;
  }

  logger.info(summary, 'tick complete');
  return summary;
}
