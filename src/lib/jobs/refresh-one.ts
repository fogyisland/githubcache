import type { RefreshJob, Repository } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { fetchRepoCore } from '@/lib/github/client';
import { parseRepoResponse } from '@/lib/github/fields';
import { storeRepoMetadata } from '@/lib/cache';
import { nextDelay } from '@/lib/scheduler/aging';
import { writeAudit } from '@/lib/audit/writer';
import {
  NotFoundError,
  GitHubError,
  GitHubUnavailable,
  AppError,
} from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Result of a single refresh job attempt, returned to the scheduler (M5.5)
 * so it can decide what to log at the batch level.
 *
 * - `done`    — refresh completed (200 or 304) OR a non-terminal failure
 *               (404) was recorded and the next attempt is already scheduled.
 * - `pending` — transient failure (429/5xx/unavailable) OR non-terminal hard
 *               failure (attempts < 5). Lock released, next run scheduled.
 * - `failed`  — terminal (403 OR 5 consecutive failures). No automatic retry.
 */
export type RefreshJobResult =
  | { status: 'done' }
  | { status: 'pending' }
  | { status: 'failed'; error: string };

// Transient-error reschedule windows. Hard-coded per spec §6.5.
const TRANSIENT_RESCHEDULE_MS = 30_000; // 30s for GitHubUnavailable / 429
const FIVE_S_SERVER_ERROR_RESCHEDULE_MS = 5_000; // 5s for 5xx

// Failure-escalation audit log action (consecutive 404 → admin review).
// Choice rationale: 'repo_not_found_escalation' describes both the trigger
// (repo not found) and the consequence (escalation to admin).
const ESCALATION_AUDIT_ACTION = 'repo_not_found_escalation';

/**
 * Process a single claimed refresh job: fetch from GitHub, upsert cache,
 * reschedule based on the aging policy, and return a status for the scheduler.
 *
 * Branching rules (spec §6.5):
 *   200 OK  → parse+upsert, status='done', schedule next via successDelay
 *   304     → skip parse/upsert, status='done', schedule next via successDelay
 *   404/410 → fetchStatus='not_found', increment attempts, failureDelay
 *   403     → fetchStatus='forbidden', audit log, status='failed' (terminal)
 *   429     → transient, no attempt increment, 30s reschedule
 *   5xx     → transient, no attempt increment, 5s reschedule
 *   Unavail → transient, no attempt increment, 30s reschedule
 *   Other   → increment attempts, failureDelay; if attempts >= 5 → failed + audit
 */
export async function refreshOne(
  job: RefreshJob & { repository: Repository },
): Promise<RefreshJobResult> {
  const repo = job.repository;

  // Count prior successful refreshes for the aging policy. Done before the
  // fetch so the scheduling decision is based on the count BEFORE this run.
  const refreshCount = await prisma.refreshJob.count({
    where: { repositoryId: repo.id, status: 'done' },
  });

  // Hot-bump override: lots of recent queries → keep refresh cadence tight.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentQueryCount24h = await prisma.requestLog.count({
    where: { repoRequested: `${repo.owner}/${repo.name}`, createdAt: { gte: since } },
  });

  try {
    const result = await fetchRepoCore(repo.owner, repo.name, repo.etag ?? undefined);

    if (result.notModified) {
      // 304 — content unchanged. Still counts as a successful refresh.
      // Spec §6.4: update last_fetched_at even on 304 (proves the cache is
      // still fresh; no other fields touched).
      await prisma.repository.update({
        where: { id: repo.id },
        data: { lastFetchedAt: new Date() },
      });
      const delay = nextDelay(refreshCount, recentQueryCount24h);
      await prisma.refreshJob.update({
        where: { id: job.id },
        data: {
          status: 'done',
          lockedUntil: null,
          scheduledFor: new Date(Date.now() + delay.ms),
          lastError: null,
        },
      });
      logger.info(
        { jobId: job.id.toString(), owner: repo.owner, name: repo.name },
        'refresh: 304 not modified',
      );
      return { status: 'done' };
    }

    if (result.data === undefined) {
      // Defensive: fetchRepoCore contract guarantees either data or notModified.
      throw new Error('fetchRepoCore returned neither data nor notModified');
    }

    const metadata = parseRepoResponse(result.data);
    await storeRepoMetadata({
      owner: repo.owner,
      name: repo.name,
      node: result.data,
      metadata,
      ...(result.etag !== undefined ? { etag: result.etag } : {}),
      fetchStatus: 'ok',
    });

    const delay = nextDelay(refreshCount, recentQueryCount24h);
    await prisma.refreshJob.update({
      where: { id: job.id },
      data: {
        status: 'done',
        lockedUntil: null,
        scheduledFor: new Date(Date.now() + delay.ms),
        lastError: null,
      },
    });
    logger.info(
      { jobId: job.id.toString(), owner: repo.owner, name: repo.name },
      'refresh: 200 ok',
    );
    return { status: 'done' };
  } catch (e: unknown) {
    return handleError(e, job, repo);
  }
}

async function handleError(
  e: unknown,
  job: RefreshJob,
  repo: Repository,
): Promise<RefreshJobResult> {
  // 404 / 410 — repo missing or gone. Not terminal; keep trying per spec.
  if (
    e instanceof NotFoundError ||
    (e instanceof GitHubError && (e.httpStatus === 404 || e.httpStatus === 410))
  ) {
    await storeRepoMetadata({
      owner: repo.owner,
      name: repo.name,
      node: repo.node,
      metadata: null,
      fetchStatus: 'not_found',
      fetchError: e.message,
    });
    const attempts = job.attempts + 1;
    const delay = nextDelay(attempts, -1); // failure mode
    const terminal = attempts >= 5;
    await prisma.refreshJob.update({
      where: { id: job.id },
      data: {
        status: terminal ? 'failed' : 'pending',
        lockedUntil: null,
        scheduledFor: new Date(Date.now() + delay.ms),
        lastError: e.message,
        attempts,
      },
    });
    if (terminal) {
      // 5 consecutive not_founds — escalate to admin.
      await writeAudit({
        action: ESCALATION_AUDIT_ACTION,
        targetType: 'repository',
        targetId: `${repo.owner}/${repo.name}`,
        metadata: { repoId: repo.id.toString(), attempts, message: e.message },
      });
      logger.warn(
        { jobId: job.id.toString(), owner: repo.owner, name: repo.name, attempts },
        'refresh: 404 escalation, status=failed',
      );
      return { status: 'failed', error: e.message };
    }
    logger.info(
      { jobId: job.id.toString(), owner: repo.owner, name: repo.name, attempts },
      'refresh: 404, will retry',
    );
    return { status: 'pending' };
  }

  // 403 — terminal. Admin must intervene.
  if (e instanceof GitHubError && e.httpStatus === 403) {
    await storeRepoMetadata({
      owner: repo.owner,
      name: repo.name,
      node: repo.node,
      metadata: null,
      fetchStatus: 'forbidden',
      fetchError: e.message,
    });
    await writeAudit({
      action: 'repo_forbidden',
      targetType: 'repository',
      targetId: `${repo.owner}/${repo.name}`,
      metadata: { repoId: repo.id.toString(), status: 403, message: e.message },
    });
    await prisma.refreshJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        lockedUntil: null,
        lastError: e.message,
      },
    });
    logger.warn(
      { jobId: job.id.toString(), owner: repo.owner, name: repo.name },
      'refresh: 403 forbidden, terminal',
    );
    return { status: 'failed', error: e.message };
  }

  // 429 — rate limited. Transient, no attempt increment.
  if (e instanceof GitHubError && e.httpStatus === 429) {
    await prisma.refreshJob.update({
      where: { id: job.id },
      data: {
        status: 'pending',
        lockedUntil: null,
        scheduledFor: new Date(Date.now() + TRANSIENT_RESCHEDULE_MS),
        lastError: e.message,
      },
    });
    logger.info(
      { jobId: job.id.toString(), owner: repo.owner, name: repo.name },
      'refresh: 429 rate limited, will retry in 30s',
    );
    return { status: 'pending' };
  }

  // 5xx — server error. Transient, no attempt increment.
  if (e instanceof GitHubError && e.httpStatus >= 500) {
    await prisma.refreshJob.update({
      where: { id: job.id },
      data: {
        status: 'pending',
        lockedUntil: null,
        scheduledFor: new Date(Date.now() + FIVE_S_SERVER_ERROR_RESCHEDULE_MS),
        lastError: e.message,
      },
    });
    logger.info(
      { jobId: job.id.toString(), owner: repo.owner, name: repo.name, status: e.httpStatus },
      'refresh: 5xx, will retry in 5s',
    );
    return { status: 'pending' };
  }

  // Pool exhausted or network down. Transient.
  if (e instanceof GitHubUnavailable) {
    await prisma.refreshJob.update({
      where: { id: job.id },
      data: {
        status: 'pending',
        lockedUntil: null,
        scheduledFor: new Date(Date.now() + TRANSIENT_RESCHEDULE_MS),
        lastError: e.message,
      },
    });
    logger.info(
      { jobId: job.id.toString(), owner: repo.owner, name: repo.name },
      'refresh: github unavailable, will retry in 30s',
    );
    return { status: 'pending' };
  }

  // Anything else — hard error. Increment attempts, run failure ladder.
  const attempts = job.attempts + 1;
  const message = e instanceof AppError ? e.message : e instanceof Error ? e.message : String(e);
  const delay = nextDelay(attempts, -1);
  const terminal = attempts >= 5;
  await prisma.refreshJob.update({
    where: { id: job.id },
    data: {
      status: terminal ? 'failed' : 'pending',
      lockedUntil: null,
      scheduledFor: new Date(Date.now() + delay.ms),
      lastError: message,
      attempts,
    },
  });
  if (terminal) {
    // 5 consecutive unexpected errors — also escalate. Spec doesn't say what
    // action string to use, so reuse the 404 escalation symbol.
    await writeAudit({
      action: ESCALATION_AUDIT_ACTION,
      targetType: 'repository',
      targetId: `${repo.owner}/${repo.name}`,
      metadata: { repoId: repo.id.toString(), attempts, message, kind: 'unexpected' },
    });
    logger.warn(
      { jobId: job.id.toString(), owner: repo.owner, name: repo.name, attempts },
      'refresh: unexpected error escalation, status=failed',
    );
    return { status: 'failed', error: message };
  }
  logger.info(
    { jobId: job.id.toString(), owner: repo.owner, name: repo.name, attempts },
    'refresh: unexpected error, will retry',
  );
  return { status: 'pending' };
}
