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

/**
 * Slim projection of a GitHub release — only the fields we store in metadata.
 * Full release payloads include `body` (markdown) + `assets[]` (each with
 * `browser_download_url`, `size`, `content_type`, ...). We keep assets as a
 * count + the head URL so consumers can fetch binaries on demand.
 */
export interface ReleaseSummary {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  tarball_url: string | null;
  zipball_url: string | null;
  assets_count: number;
}

/**
 * Slim projection of a GitHub branch — only name + protection + head SHA.
 */
export interface BranchSummary {
  name: string;
  protected: boolean;
  commit_sha: string;
}

const MAX_RELEASES = 10;
const MAX_BRANCHES = 20;

/**
 * Map a raw GitHub release object to the slim metadata projection. Defensive
 * against null/missing fields — every field has a sensible fallback.
 */
function toReleaseSummary(raw: unknown): ReleaseSummary {
  const r = raw as {
    tag_name?: unknown;
    name?: unknown;
    published_at?: unknown;
    html_url?: unknown;
    prerelease?: unknown;
    draft?: unknown;
    tarball_url?: unknown;
    zipball_url?: unknown;
    assets?: unknown;
  };
  const assets = Array.isArray(r.assets) ? r.assets : [];
  return {
    tag_name: String(r.tag_name ?? ''),
    name: (r.name ?? null) as string | null,
    published_at: (r.published_at ?? null) as string | null,
    html_url: String(r.html_url ?? ''),
    prerelease: Boolean(r.prerelease),
    draft: Boolean(r.draft),
    tarball_url: (r.tarball_url ?? null) as string | null,
    zipball_url: (r.zipball_url ?? null) as string | null,
    assets_count: assets.length,
  };
}

/**
 * Map a raw GitHub branch object to the slim metadata projection.
 */
function toBranchSummary(raw: unknown): BranchSummary {
  const r = raw as {
    name?: unknown;
    protected?: unknown;
    commit?: { sha?: unknown };
  };
  return {
    name: String(r.name ?? ''),
    protected: Boolean(r.protected),
    commit_sha: String(r.commit?.sha ?? ''),
  };
}

/**
 * Fetch `/repos/{owner}/{name}/releases?per_page=10` and `/branches?per_page=20`
 * concurrently via the same token that just did the main GET. Both are
 * non-fatal: failures are caught, logged, and surfaced as empty arrays so a
 * flaky secondary call doesn't poison the whole refresh.
 *
 * Returns `{releases, branches}` (always set, may be empty).
 */
async function fetchVersionExtras(
  octokit: import('@octokit/rest').Octokit,
  owner: string,
  name: string,
): Promise<{ releases: ReleaseSummary[]; branches: BranchSummary[] }> {
  const [releasesResult, branchesResult] = await Promise.allSettled([
    octokit.repos.listReleases({ owner, repo: name, per_page: MAX_RELEASES }),
    octokit.repos.listBranches({ owner, repo: name, per_page: MAX_BRANCHES }),
  ]);
  if (releasesResult.status === 'rejected') {
    logger.warn(
      { err: releasesResult.reason, owner, name },
      'github listReleases failed; storing empty releases',
    );
  }
  if (branchesResult.status === 'rejected') {
    logger.warn(
      { err: branchesResult.reason, owner, name },
      'github listBranches failed; storing empty branches',
    );
  }
  const releases =
    releasesResult.status === 'fulfilled'
      ? (releasesResult.value.data as unknown[]).map(toReleaseSummary)
      : [];
  const branches =
    branchesResult.status === 'fulfilled'
      ? (branchesResult.value.data as unknown[]).map(toBranchSummary)
      : [];
  return { releases, branches };
}

export interface FetchRepoCoreResult {
  data?: unknown;
  etag?: string;
  notModified?: boolean;
  /**
   * Top-N releases (most recent first). Set on 200 only — omitted on 304 to
   * avoid 2 extra API calls per cache hit.
   */
  releases?: ReleaseSummary[];
  /**
   * Top-N branches (alphabetical / default order from GitHub). Set on 200 only.
   */
  branches?: BranchSummary[];
}

export async function fetchRepoCore(
  owner: string,
  name: string,
  etag?: string,
): Promise<FetchRepoCoreResult> {
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

      // M20.8: also fetch top-N releases + top-N branches for version data.
      // Non-fatal: a flaky listReleases / listBranches call does NOT poison
      // the whole refresh — we just store empty arrays in metadata.
      const { releases, branches } = await fetchVersionExtras(
        picked.octokit,
        owner,
        name,
      );

      if (responseEtag) {
        return { data: res.data, etag: responseEtag, releases, branches };
      }
      return { data: res.data, releases, branches };
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
      // notModified so caller can skip the parse+upsert. We deliberately do
      // NOT fetch version extras on 304 — the caller already has them, and
      // this saves 2 API calls per cache hit.
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
        // 403 with remaining=0 means this token is exhausted — mark it
        // exhausted in the pool so poolStatus() reports it, then rotate.
        // Without recordUsage() the in-memory entry stays fresh-looking
        // and the scheduler keeps picking it (M22.1 fix).
        if (remaining === 0) {
          const resetRaw = err.response?.headers?.['x-ratelimit-reset'];
          const reset = resetRaw !== undefined ? Number.parseInt(resetRaw, 10) : 0;
          if (Number.isFinite(reset) && reset > 0) {
            await recordUsage(picked.id, 0, reset);
          }
          logger.warn(
            { tokenId: picked.id.toString(), attempt, resetAt: reset },
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