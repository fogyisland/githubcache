import { Prisma } from '@prisma/client';
import type { FetchStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { getRepoMetadata } from '@/lib/cache/read';
import { nextDueForStatus } from '@/lib/scheduler/aging';
import { env } from '@/lib/config/env';
import { estimateExpectedAt, getQueueDepth, getMedianFetchMs } from '@/lib/cache/eta';

export interface ResultOk {
  canonical: string;
  original: string;
  found: true;
  metadata: unknown;
  last_fetched_at: Date | null;
  fetch_status: 'ok';
  stale: boolean;
  warning?: string;
}
export interface ResultNotFound {
  canonical: string;
  original: string;
  found: false;
  fetch_status: 'not_found';
  error: string;
}
/**
 * M20: cache miss returns a 'pending' result instead of synchronously
 * fetching GitHub. The owner/name is enqueued into refresh_jobs; the
 * scheduler tick (next batch claim) will fetch the metadata and write
 * back to the repositories table. Subsequent queries will hit cache.
 */
export interface ResultPending {
  canonical: string;
  original: string;
  found: false;
  fetch_status: 'pending';
  queuedAt: string; // ISO timestamp when the job was enqueued
  scheduledFor: string; // ISO timestamp when scheduler is expected to run
  expectedAt: string; // M30.7c — ISO ETA when caller can expect the fetch to complete
  schedulerTickMs: number; // M30.7c — ms between scheduler ticks
  schedulerBatchSize: number; // M30.7c — jobs per batch
}
export interface ResultError {
  canonical: string;
  original: string;
  found: false;
  fetch_status: 'error';
  error: string;
}
export type QueryResult = ResultOk | ResultNotFound | ResultPending | ResultError;

export const STALE_WARNING = 'data may be delayed';

/**
 * M31: enqueue a refresh job for an owner/name that is missing or stale
 * in the cache. No stub repositories row is created — refresh_jobs
 * reference owner/name directly and the scheduler worker writes a
 * repositories row only after GitHub returns data.
 *
 * Idempotent: if a pending job already exists for the same owner/name,
 * we don't create a duplicate — claim will pick it up on the next tick.
 */
async function enqueueRefresh(owner: string, name: string): Promise<{
  queuedAt: Date;
  scheduledFor: Date;
  queueDepth: number;
  medianFetchMs: number;
}> {
  const queuedAt = new Date();
  // M31.1 — wrap the findFirst + create in a single transaction with
  // SERIALIZABLE isolation so concurrent identical requests can't both
  // observe "no existing pending job" and then both INSERT. Without
  // this, two simultaneous lookupRepo('foo', 'bar') calls (e.g. from
  // a public-form submit + a /api/query POST landing in the same
  // scheduler tick) produce two pending jobs for the same target —
  // the scheduler will fetch GitHub twice and double-bill the rate-
  // limit pool. MySQL SERIALIZABLE maps to "SELECT ... FOR UPDATE"
  // everywhere in the transaction, so the second concurrent caller
  // blocks until the first commits and then sees the row.
  //
  // Edge case: when two callers both reach the INSERT path under
  // SERIALIZABLE, InnoDB may pick one as the deadlock victim and
  // raise 1213 / Prisma P2034 ("Transaction failed due to a write
  // conflict or a deadlock. Please retry your transaction."). The
  // losing transaction must retry; on the second attempt the winner's
  // row is visible, so we hit the existing-pending branch and return
  // the deduped shape without inserting a duplicate. One retry is
  // enough — InnoDB's deadlock detector doesn't loop a single pair
  // of transactions back into the same conflict.
  const MAX_ATTEMPTS = 3;
  let attempt = 0;
  let enqueueResult: {
    kind: 'existing' | 'created';
    queuedAt: Date;
    scheduledFor: Date;
  };
  while (true) {
    attempt += 1;
    try {
      enqueueResult = await prisma.$transaction(
        async (tx) => {
          const existing = await tx.refreshJob.findFirst({
            where: { owner, name, status: 'pending' },
            select: { scheduledFor: true, createdAt: true },
          });
          if (existing) {
            return {
              kind: 'existing' as const,
              queuedAt: existing.createdAt,
              scheduledFor: existing.scheduledFor,
            };
          }
          const scheduledFor = queuedAt;
          await tx.refreshJob.create({
            data: {
              owner,
              name,
              repositoryId: null,
              priority: 70,
              scheduledFor,
            },
          });
          return {
            kind: 'created' as const,
            queuedAt,
            scheduledFor,
          };
        },
        { isolationLevel: 'Serializable' },
      );
      break;
    } catch (e: unknown) {
      // Prisma surfaces MySQL's 1213 (deadlock) as a generic
      // PrismaClientKnownRequestError with code 'P2034'. Retry until
      // we win or hit MAX_ATTEMPTS — but don't loop forever, a real
      // bug shouldn't be masked.
      const code =
        e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
      if (code !== 'P2034' || attempt >= MAX_ATTEMPTS) {
        throw e;
      }
      // brief jitter so the losing caller doesn't immediately re-try
      // into the same gap-lock conflict. 5-15ms is enough.
      await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 10)));
    }
  }

  // After commit, fetch the depth / median with the post-create row
  // visible. Same shape as before — existing callers don't care whether
  // the row came from an existing match or a fresh insert.
  const [depth, median] = await Promise.all([getQueueDepth(), getMedianFetchMs()]);
  return {
    queuedAt: enqueueResult.queuedAt,
    scheduledFor: enqueueResult.scheduledFor,
    queueDepth: depth,
    medianFetchMs: median,
  };
}

/**
 * A row is stale when its fetchStatus window has elapsed since lastFetchedAt.
 * Used to surface `stale: true` + a "data may be delayed" warning on cache
 * hits whose 'ok' fetch has aged past the 24h TTL.
 *
 * Returns false when lastFetchedAt is null (never fetched — caller treats
 * this as fresh and overwrites via enqueueRefresh + scheduler fetch).
 */
function isStale(
  fetchStatus: FetchStatus,
  lastFetchedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastFetchedAt) return false;
  return now > nextDueForStatus(fetchStatus, lastFetchedAt);
}

function buildOkResult(
  owner: string,
  repoName: string,
  original: string,
  metadata: unknown,
  lastFetchedAt: Date | null,
): ResultOk {
  const stale = isStale('ok', lastFetchedAt);
  return {
    canonical: `${owner}/${repoName}`,
    original,
    found: true,
    metadata,
    last_fetched_at: lastFetchedAt,
    fetch_status: 'ok',
    stale,
    ...(stale ? { warning: STALE_WARNING } : {}),
  };
}

function buildPendingResult(
  owner: string,
  name: string,
  original: string,
  queuedAt: Date,
  scheduledFor: Date,
  expectedAt: Date,
): ResultPending {
  return {
    canonical: `${owner}/${name}`,
    original,
    found: false,
    fetch_status: 'pending',
    queuedAt: queuedAt.toISOString(),
    scheduledFor: scheduledFor.toISOString(),
    expectedAt: expectedAt.toISOString(),
    schedulerTickMs: env.SCHEDULER_TICK_MS,
    schedulerBatchSize: env.SCHEDULER_BATCH_SIZE,
  };
}

/**
 * Look up a single repo. Used by:
 * - POST /api/query (per-node, in a batch)
 * - The public form server action (M9.4)
 * - The /repo/[owner]/[name] detail page (M9.6)
 *
 * Behaviour (M20 — queue-on-miss):
 * 1. Read cache. If 'ok' → return with stale flag.
 * 2. If 'not_found' → return not_found (terminal, do not re-enqueue).
 * 3. Otherwise (missing row / 'forbidden' / 'error') → enqueue a refresh
 *    job and return a 'pending' result. The scheduler tick will fetch
 *    the metadata on its next claimBatch pass and write back to the
 *    repositories table. Subsequent queries will hit cache.
 */
export async function lookupRepo(owner: string, name: string): Promise<QueryResult> {
  const original = `${owner}/${name}`;
  const r = await getRepoMetadata(owner, name);
  if (r.found) {
    if (r.fetchStatus === 'ok') {
      return buildOkResult(owner, name, original, r.metadata, r.lastFetchedAt);
    }
    if (r.fetchStatus === 'not_found') {
      return {
        canonical: original,
        original,
        found: false,
        fetch_status: 'not_found',
        error: 'Repository not found or private',
      };
    }
    // forbidden/error: re-enqueue so scheduler can retry.
  }
  try {
    const { queuedAt, scheduledFor, queueDepth, medianFetchMs } = await enqueueRefresh(owner, name);
    const expectedAt = estimateExpectedAt({
      queueDepth,
      tickMs: env.SCHEDULER_TICK_MS,
      batchSize: env.SCHEDULER_BATCH_SIZE,
      medianFetchMs,
    });
    return buildPendingResult(owner, name, original, queuedAt, scheduledFor, expectedAt);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return {
      canonical: original,
      original,
      found: false,
      fetch_status: 'error',
      error: msg,
    };
  }
}
