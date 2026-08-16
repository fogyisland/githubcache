import { GitHubError, GitHubUnavailable, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  pickToken,
  recordUsage,
  getBackoff,
  initPool,
} from '@/lib/github/pool';

let poolInitPromise: Promise<void> | null = null;

async function ensurePoolInitialized(): Promise<void> {
  if (!poolInitPromise) {
    poolInitPromise = initPool().catch((e: unknown) => {
      poolInitPromise = null; // allow retry on next call
      throw e;
    });
  }
  return poolInitPromise;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const MAX_ATTEMPTS = 3;

export async function fetchRepoCore(
  owner: string,
  name: string,
  etag?: string,
): Promise<{ data?: unknown; etag?: string; notModified?: boolean }> {
  await ensurePoolInitialized();

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const picked = pickToken();
    if (!picked) {
      throw new GitHubUnavailable(
        'no github tokens available (all exhausted or pool not initialized)',
      );
    }

    try {
      const res = await picked.octokit.repos.get({
        owner,
        repo: name,
        ...(etag !== undefined ? { headers: { 'If-None-Match': etag } } : {}),
      });
      const responseEtag = res.headers.etag ?? undefined;

      // Record rate-limit usage on success
      const remainingRaw = res.headers['x-ratelimit-remaining'];
      const resetRaw = res.headers['x-ratelimit-reset'];
      if (remainingRaw !== undefined && resetRaw !== undefined) {
        const remaining = Number.parseInt(remainingRaw, 10);
        const reset = Number.parseInt(resetRaw, 10);
        if (Number.isFinite(remaining) && Number.isFinite(reset) && reset > 0) {
          await recordUsage(picked.id, remaining, reset);
        }
      }

      if (responseEtag) {
        return { data: res.data, etag: responseEtag };
      }
      return { data: res.data };
    } catch (e: unknown) {
      lastError = e;
      const err = e as {
        status?: number;
        message?: string;
        response?: { headers?: Record<string, string | undefined> };
      };
      const status = err?.status;

      // 304 Not Modified — Octokit throws on 3xx by default. The etag is still
      // valid (we sent it, server confirmed resource is unchanged). Return
      // notModified so caller can skip the parse+upsert.
      if (status === 304) {
        return etag !== undefined
          ? { notModified: true, etag }
          : { notModified: true };
      }

      if (status === 404) {
        throw new NotFoundError(`Repo ${owner}/${name} not found`);
      }

      if (status === 403) {
        const remainingRaw = err.response?.headers?.['x-ratelimit-remaining'];
        const remaining =
          remainingRaw !== undefined ? Number.parseInt(remainingRaw, 10) : NaN;
        // 403 with remaining=0 means this token is exhausted — rotate to next
        if (remaining === 0) {
          logger.warn(
            { tokenId: picked.id.toString(), attempt },
            'github token exhausted, rotating',
          );
          continue;
        }
        throw new GitHubError('GH_FORBIDDEN', 403, err.message ?? 'forbidden');
      }

      if (status === 429) {
        const backoffMs = getBackoff();
        logger.warn({ backoffMs, attempt }, 'github rate limited, backing off');
        await sleep(backoffMs);
        continue;
      }

      if (status !== undefined && status >= 500) {
        await sleep(1000);
        continue;
      }

      logger.error({ err, attempt }, 'unexpected github error');
      throw new GitHubError(
        'GH_ERROR',
        status ?? 500,
        err?.message ?? 'unknown',
      );
    }
  }

  throw new GitHubUnavailable(
    `github unreachable after ${MAX_ATTEMPTS} attempts: ${(lastError as Error)?.message ?? 'unknown'}`,
  );
}