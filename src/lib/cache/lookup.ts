import type { FetchStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { getRepoMetadata } from '@/lib/cache/read';
import { nextDueForStatus } from '@/lib/scheduler/aging';

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
 * M20: enqueue a refresh job for an owner/name that is missing or stale
 * in the cache. Upserts a stub repositories row (so refreshJob has a
 * repositoryId foreign key) and creates a refresh_job at priority 70.
 *
 * Idempotent: if a pending job already exists for the same repo, we
 * don't create a duplicate — claim will pick it up on the next tick.
 */
async function enqueueRefresh(owner: string, name: string): Promise<{
  queuedAt: Date;
  scheduledFor: Date;
}> {
  const queuedAt = new Date();
  // repositoryId is a FK on refresh_jobs, so we need a repositories row
  // even before the first fetch. Upsert keeps any existing metadata
  // (e.g. a stale 'ok' row) untouched on update.
  const repo = await prisma.repository.upsert({
    where: { owner_name: { owner, name } },
    create: {
      owner,
      name,
      node: { stub: true } as never,
      fetchStatus: 'ok',
    },
    update: {},
    select: { id: true },
  });
  // Skip duplicate pending job for the same repo (queue depth 1).
  const existing = await prisma.refreshJob.findFirst({
    where: { repositoryId: repo.id, status: 'pending' },
    select: { scheduledFor: true, createdAt: true },
  });
  if (existing) {
    return { queuedAt: existing.createdAt, scheduledFor: existing.scheduledFor };
  }
  const scheduledFor = queuedAt;
  await prisma.refreshJob.create({
    data: {
      repositoryId: repo.id,
      priority: 70,
      scheduledFor,
    },
  });
  return { queuedAt, scheduledFor };
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
): ResultPending {
  return {
    canonical: `${owner}/${name}`,
    original,
    found: false,
    fetch_status: 'pending',
    queuedAt: queuedAt.toISOString(),
    scheduledFor: scheduledFor.toISOString(),
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
    const { queuedAt, scheduledFor } = await enqueueRefresh(owner, name);
    return buildPendingResult(owner, name, original, queuedAt, scheduledFor);
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
