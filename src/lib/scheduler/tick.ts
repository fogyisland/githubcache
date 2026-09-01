import { claimBatch } from '@/lib/scheduler/lease';
import { refreshOne, type RefreshJobResult } from '@/lib/jobs/refresh-one';
import { prisma } from '@/lib/db/client';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/logger';
import { isPaused, pause, resume } from '@/lib/scheduler/state';
import { poolStatus } from '@/lib/github/pool';

export interface TickResult {
  claimed: number;
  done: number;
  pending: number;
  failed: number;
}

// M22 — auto-pause on rate-limit exhaustion. When all in-memory tokens are
// exhausted (resetAt > now && requestsUsed >= requestsLimit), the scheduler
// pauses itself and schedules a single setTimeout to resume at the earliest
// resetAt. Without this, the tick kept firing every second, logging
// "github unavailable, will retry in 30s" per job — wasteful once the
// exhaustion is known.
//
// Module-local because the auto-pause is a tick-internal detail; pause()/resume()
// themselves live in scheduler/state.ts (M7.6) and are still callable from
// the admin UI / external triggers.
let autoPaused = false;
let autoResumeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoResume(resetAt: Date, reason: string): void {
  if (autoResumeTimer) clearTimeout(autoResumeTimer);
  const ms = Math.max(0, resetAt.getTime() - Date.now()) + 1_000; // +1s buffer
  autoResumeTimer = setTimeout(() => {
    autoPaused = false;
    autoResumeTimer = null;
    resume();
    logger.info({ reason }, 'rate-limit window reset; auto-resumed scheduler');
  }, ms);
  autoResumeTimer.unref?.();
}

/**
 * Test-only helper: clear the module-local auto-pause flag and cancel the
 * scheduled resume timer. Used by scheduler-tick.test.ts afterEach to keep
 * tests independent — production code never calls this.
 *
 * Why it's needed: `autoPaused` is module-local (not part of pause/resume
 * state.ts) so the test's `resume()` reset doesn't touch it. Without this,
 * a second test that re-enters the exhausted branch would skip the pause()
 * call because `autoPaused` is still true from the previous test.
 */
export function _resetAutoPauseForTesting(): void {
  autoPaused = false;
  if (autoResumeTimer) {
    clearTimeout(autoResumeTimer);
    autoResumeTimer = null;
  }
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
  // M22 — auto-pause handling runs BEFORE the manual isPaused() check,
  // because auto-pause ALSO sets the paused flag (so isPaused() returns
  // true after we pause). The auto-resume branch below is the only way the
  // scheduler un-pauses itself; manual pause() calls are never auto-resumed.
  const status = poolStatus();

  // All tokens exhausted → auto-pause + schedule resume at earliest resetAt.
  if (status.active === 0 && status.exhausted > 0) {
    if (!autoPaused) {
      autoPaused = true;
      pause();
      logger.warn(
        {
          exhausted: status.exhausted,
          resetAt: status.earliestReset?.toISOString(),
        },
        'all github tokens exhausted; auto-paused scheduler until rate-limit reset',
      );
      if (status.earliestReset) scheduleAutoResume(status.earliestReset, 'token resetAt');
    }
    return { claimed: 0, done: 0, pending: 0, failed: 0 };
  }

  // Tokens available again after an auto-pause → auto-resume.
  if (autoPaused && status.active > 0) {
    autoPaused = false;
    if (autoResumeTimer) {
      clearTimeout(autoResumeTimer);
      autoResumeTimer = null;
    }
    resume();
    logger.info('github tokens available again; auto-resumed scheduler');
  }

  // Pause check at the START of tick — claimed jobs from previous ticks
  // (already in_progress) still complete, but no new jobs are claimed.
  // Runs AFTER auto-resume so an auto-pause is correctly lifted when tokens
  // become available again, but manual pause() calls still hold the line.
  if (isPaused()) {
    logger.info('scheduler is paused; skipping tick');
    return { claimed: 0, done: 0, pending: 0, failed: 0 };
  }

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
