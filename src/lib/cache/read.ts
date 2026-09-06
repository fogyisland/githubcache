import { prisma } from '@/lib/db/client';
import { findRepoByCanonical } from '@/lib/db/repositories';
import { env } from '@/lib/config/env';
import type { FetchStatus } from '@prisma/client';

export type RepoMetadataResult =
  | {
      found: true;
      metadata: unknown;
      lastFetchedAt: Date | null;
      fetchStatus: Exclude<FetchStatus, 'not_found'>;
      etag: string | null;
    }
  | {
      found: true;
      metadata: null;
      lastFetchedAt: Date | null;
      fetchStatus: 'not_found';
      etag: string | null;
    }
  | { found: false };

// -----------------------------------------------------------------------------
// M27.3 — assemble the legacy `metadata` JSON shape from the new typed
// columns + child tables. Used when M27_READ_FROM_TABLES=true. The shape
// matches what the legacy `metadata` JSON had so the read path stays
// drop-in compatible — no caller change required.
// -----------------------------------------------------------------------------
export async function getRepoMetadataFromTables(
  owner: string,
  name: string,
): Promise<RepoMetadataResult> {
  const row = await prisma.repository.findUnique({
    where: { owner_name: { owner, name } },
    include: {
      releases: {
        orderBy: { publishedAt: 'desc' },
        take: 20,
      },
      _count: { select: { releases: true } },
    },
  });
  if (!row) return { found: false };

  if (row.fetchStatus === 'not_found') {
    return {
      found: true,
      metadata: null,
      lastFetchedAt: row.lastFetchedAt,
      fetchStatus: 'not_found',
      etag: row.etag,
    };
  }

  // Assemble the same shape the legacy `metadata` JSON had. Field
  // names match the local RepoCoreData / M9.x parser shape (`stars`,
  // `forks`, `watchers`) — NOT GitHub's wire format (`stargazers_count`)
  // — because the legacy code path returned the parsed JSON directly
  // to clients, so callers expect `body.repository.stars`. M27 is
  // not the place to rename the public surface.
  const md = {
    name: row.name,
    full_name: `${row.owner}/${row.name}`,
    private: row.private,
    description: row.description,
    fork: false,
    stars: row.stars,
    forks: row.forks,
    watchers: row.watchers,
    subscribers_count: 0,
    defaultBranch: row.defaultBranch,
    language: row.language,
    license: row.license,
    topics: row.topics as unknown,
    homepage: row.homepage,
    archived: row.archived,
    disabled: row.disabled,
    // Strip milliseconds to match the legacy metadata JSON shape
    // (which stored dates like '2020-01-01T00:00:00Z', no ms). toISOString()
    // always emits ms, so we replace `.sssZ` with just `Z`.
    createdAt: row.repoCreatedAt?.toISOString().replace(/\.\d{3}Z$/, 'Z') ?? null,
    updatedAt: row.repoUpdatedAt?.toISOString().replace(/\.\d{3}Z$/, 'Z') ?? null,
    pushedAt: row.repoPushedAt?.toISOString().replace(/\.\d{3}Z$/, 'Z') ?? null,
    // Volatile sections — top-N releases from repo_releases.
    latestRelease: row.releases[0]
      ? {
          tag: row.releases[0].tag,
          name: row.releases[0].name,
          // Strip ms to match the legacy metadata shape.
          published_at: row.releases[0].publishedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          prerelease: row.releases[0].prerelease,
          draft: row.releases[0].draft,
        }
      : null,
    recentReleases: row.releases.map((r) => ({
      tag: r.tag,
      name: r.name,
      // Strip ms to match the legacy metadata shape.
      published_at: r.publishedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      prerelease: r.prerelease,
      draft: r.draft,
    })),
    releaseCount: row._count.releases,
    // M27.4 — branches will be joined from repo_branches here.
    // Until then, fall back to the legacy JSON if present.
    branches: ((row.metadata as { branches?: unknown } | null)?.branches ?? []) as unknown,
    node: (row.node as unknown) ?? null,
  };

  return {
    found: true,
    metadata: md,
    lastFetchedAt: row.lastFetchedAt,
    fetchStatus: row.fetchStatus,
    etag: row.etag,
  };
}

export async function getRepoMetadata(owner: string, name: string): Promise<RepoMetadataResult> {
  // M27.3 — feature-flagged dispatch. Off (default) = legacy path.
  if (env.M27_READ_FROM_TABLES) {
    return getRepoMetadataFromTables(owner, name);
  }
  const row = await findRepoByCanonical(owner, name);
  if (!row) return { found: false };
  if (row.fetchStatus === 'not_found') {
    return {
      found: true,
      metadata: null,
      lastFetchedAt: row.lastFetchedAt,
      fetchStatus: 'not_found',
      etag: row.etag,
    };
  }
  return {
    found: true,
    metadata: row.metadata,
    lastFetchedAt: row.lastFetchedAt,
    fetchStatus: row.fetchStatus,
    etag: row.etag,
  };
}
