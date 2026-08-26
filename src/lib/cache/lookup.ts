import type { FetchStatus, Prisma } from '@prisma/client';
import { GitHubUnavailable, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { fetchRepoCore } from '@/lib/github/client';
import { parseRepoResponse } from '@/lib/github/fields';
import { storeRepoMetadata } from '@/lib/cache/write';
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
export interface ResultError {
  canonical: string;
  original: string;
  found: false;
  fetch_status: 'error';
  error: string;
}
export type QueryResult = ResultOk | ResultNotFound | ResultError;

export const STALE_WARNING = 'data may be delayed';

// In-process dedupe: concurrent first-miss requests for the same
// owner/name share one upstream fetch. M5 may replace with a durable
// lock if multi-process becomes a concern.
const pending = new Map<string, Promise<unknown>>();

/**
 * Fetch + write a repo that is not yet in the cache (or whose prior row is
 * in a non-'ok' state that we want to retry). Deduplicates concurrent
 * requests for the same owner/name.
 *
 * Throws GitHubUnavailable on network errors so callers can fall back to
 * a stale 'ok' row (M8.2). NotFoundError is caught internally and turned
 * into a 'not_found' cache row.
 */
async function firstMiss(owner: string, name: string): Promise<void> {
  const key = `${owner}/${name}`;
  const existing = pending.get(key);
  if (existing) {
    await existing;
    return;
  }
  const p = (async () => {
    try {
      const { data, etag } = await fetchRepoCore(owner, name);
      const baseWrite = {
        owner,
        name,
        node: key as unknown as Prisma.InputJsonValue,
        metadata: parseRepoResponse(data),
        fetchStatus: 'ok' as const,
      };
      if (etag !== undefined) {
        await storeRepoMetadata({ ...baseWrite, etag });
      } else {
        await storeRepoMetadata(baseWrite);
      }
    } catch (e: unknown) {
      if (e instanceof NotFoundError) {
        await storeRepoMetadata({
          owner,
          name,
          node: key as unknown as Prisma.InputJsonValue,
          metadata: null,
          fetchStatus: 'not_found',
          fetchError: '404',
        });
        return;
      }
      logger.error({ err: e, owner, name }, 'first-miss fetch failed');
      throw e;
    }
  })();
  pending.set(key, p);
  try {
    await p;
  } finally {
    pending.delete(key);
  }
}

/**
 * A row is stale when its fetchStatus window has elapsed since lastFetchedAt.
 * Used to surface `stale: true` + a "data may be delayed" warning on cache
 * hits whose 'ok' fetch has aged past the 24h TTL.
 *
 * Returns false when lastFetchedAt is null (never fetched — caller treats
 * this as fresh and overwrites via firstMiss).
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

/**
 * Look up a single repo. Used by:
 * - POST /api/query (per-node, in a batch)
 * - The public form server action (M9.4)
 * - The /repo/[owner]/[name] detail page (M9.6)
 *
 * Behaviour:
 * 1. Read cache. If 'ok' → return with stale flag. If 'not_found' → return
 *    not_found. If forbidden/error → fall through to first-miss.
 * 2. Not cached OR non-ok cache → firstMiss (fetches GitHub + writes).
 * 3. On GitHubUnavailable during first-miss AND we have a prior 'ok' row
 *    → serve that row with stale:true + warning (M8.2).
 * 4. On GitHubUnavailable with no prior 'ok' row → return error.
 * 5. Read again. Return appropriate result based on the new row state.
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
    // forbidden/error: stale cache hit, treat as miss to allow refetch.
    // M4 multi-token pool handles forbidden rotation.
  }
  try {
    await firstMiss(owner, name);
  } catch (e: unknown) {
    // M8.2: GitHubUnavailable (network down / DNS fail / connection refused)
    // triggers the stale path. If we have a prior 'ok' row, serve it with
    // stale:true + a warning. Otherwise fall through to the error response.
    if (e instanceof GitHubUnavailable) {
      const stale = await getRepoMetadata(owner, name);
      if (stale.found && stale.fetchStatus === 'ok') {
        return buildOkResult(
          owner,
          name,
          original,
          stale.metadata,
          stale.lastFetchedAt,
        );
      }
    }
    const msg = e instanceof Error ? e.message : 'unknown';
    return {
      canonical: original,
      original,
      found: false,
      fetch_status: 'error',
      error: msg,
    };
  }
  const r2 = await getRepoMetadata(owner, name);
  if (!r2.found) {
    return {
      canonical: original,
      original,
      found: false,
      fetch_status: 'error',
      error: 'first-miss did not write a row',
    };
  }
  if (r2.fetchStatus === 'not_found') {
    return {
      canonical: original,
      original,
      found: false,
      fetch_status: 'not_found',
      error: 'Repository not found or private',
    };
  }
  return buildOkResult(owner, name, original, r2.metadata, r2.lastFetchedAt);
}
