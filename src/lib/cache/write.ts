import type { Prisma, Repository } from '@prisma/client';
import type { FetchStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { upsertRepo } from '@/lib/db/repositories';
import { logger } from '@/lib/logger';
import type { ReleaseSummary, BranchSummary } from '@/lib/github/client';

export async function storeRepoMetadata(args: {
  owner: string;
  name: string;
  node: unknown;
  metadata: unknown;
  etag?: string;
  fetchStatus: FetchStatus;
  fetchError?: string;
}): Promise<Repository> {
  // M27.4 fix — `metadata` is the source of truth, but the schema also
  // carries indexed flat columns (`stars`, `forks`, `description`, …) so
  // /api/v1/repos reads and `?q=stars>…` filters can hit an index. The
  // per-facet rewrite dropped the field extraction; restore it here with
  // defensive defaults so callers passing partial metadata (e.g. tests
  // with `{ stars: 42 }`) still work.
  const md = (args.metadata ?? {}) as {
    defaultBranch?: string;
    description?: string | null;
    private?: boolean;
    stars?: number;
    forks?: number;
    watchers?: number;
    language?: string | null;
    license?: string | null;
    topics?: unknown;
    homepage?: string | null;
    archived?: boolean;
    createdAt?: string;
    updatedAt?: string;
    pushedAt?: string | null;
  };
  const toBool = (v: unknown): boolean => Boolean(v);
  const toInt = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const toStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const toDate = (v: unknown): Date | null => {
    if (typeof v !== 'string' || v === '') return null;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  };
  const row = await upsertRepo({
    owner: args.owner,
    name: args.name,
    node: args.node as Prisma.InputJsonValue,
    metadata: args.metadata as Prisma.InputJsonValue,
    defaultBranch: md.defaultBranch ?? 'main',
    description: toStr(md.description),
    private: toBool(md.private),
    stars: toInt(md.stars),
    forks: toInt(md.forks),
    watchers: toInt(md.watchers),
    language: toStr(md.language),
    license: toStr(md.license),
    topics: (Array.isArray(md.topics) ? md.topics : []) as Prisma.InputJsonValue,
    homepage: toStr(md.homepage),
    archived: toBool(md.archived),
    repoCreatedAt: toDate(md.createdAt),
    repoUpdatedAt: toDate(md.updatedAt),
    repoPushedAt: toDate(md.pushedAt),
    etag: args.etag ?? null,
    lastFetchedAt: new Date(),
    fetchStatus: args.fetchStatus,
    fetchError: args.fetchError ?? null,
  });
  logger.info(
    { owner: args.owner, name: args.name, fetchStatus: args.fetchStatus },
    'repo stored',
  );
  return row;
}

// -----------------------------------------------------------------------------
// M27.4 — per-facet writers. `storeRepoReleases` and `storeRepoBranches`
// are called by the corresponding per-facet refresh jobs. They:
//   1. Replace the child-table rows wholesale (the API list is the
//      source of truth — no incremental diff).
//   2. Update the per-facet ETag + freshness timestamp on `repositories`.
//   3. Mirror the new data into the legacy `metadata` JSON on
//      `repositories` so the M27.3 off-flag read path keeps returning
//      the same shape (read-merge-write on the JSON blob).
// -----------------------------------------------------------------------------

export async function storeRepoReleases(
  owner: string,
  name: string,
  releases: ReleaseSummary[],
  etag?: string,
): Promise<void> {
  const repo = await prisma.repository.findUnique({
    where: { owner_name: { owner, name } },
    select: { id: true, metadata: true },
  });
  if (!repo) {
    logger.warn({ owner, name }, 'storeRepoReleases: repo not found');
    return;
  }

  // Read-merge-write the legacy metadata JSON so the off-flag read
  // path (M27.3) still returns releases. We keep the existing core
  // fields and only overwrite the releases-related keys.
  const existing = (repo.metadata ?? {}) as Record<string, unknown>;
  const merged = {
    ...existing,
    latestRelease: releases[0] ?? null,
    recentReleases: releases,
    releaseCount: releases.length,
  };

  await prisma.$transaction([
    prisma.repoRelease.deleteMany({ where: { repositoryId: repo.id } }),
    ...(releases.length > 0
      ? [
          prisma.repoRelease.createMany({
            data: releases.map((r) => ({
              repositoryId: repo.id,
              tag: r.tag_name,
              name: r.name,
              publishedAt: r.published_at ? new Date(r.published_at) : new Date(),
              prerelease: r.prerelease,
              draft: r.draft,
            })),
          }),
        ]
      : []),
    prisma.repository.update({
      where: { id: repo.id },
      data: {
        releasesFetchedAt: new Date(),
        ...(etag !== undefined ? { releasesEtag: etag } : {}),
        metadata: merged as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);
  logger.info(
    { owner, name, count: releases.length },
    'repo releases stored',
  );
}

export async function storeRepoBranches(
  owner: string,
  name: string,
  branches: BranchSummary[],
  etag?: string,
): Promise<void> {
  const repo = await prisma.repository.findUnique({
    where: { owner_name: { owner, name } },
    select: { id: true, metadata: true },
  });
  if (!repo) {
    logger.warn({ owner, name }, 'storeRepoBranches: repo not found');
    return;
  }

  const existing = (repo.metadata ?? {}) as Record<string, unknown>;
  const merged = { ...existing, branches };

  await prisma.$transaction([
    prisma.repoBranch.deleteMany({ where: { repositoryId: repo.id } }),
    ...(branches.length > 0
      ? [
          prisma.repoBranch.createMany({
            data: branches.map((b) => ({
              repositoryId: repo.id,
              name: b.name,
              protected: b.protected,
              lastCommitSha: b.commit_sha,
            })),
          }),
        ]
      : []),
    prisma.repository.update({
      where: { id: repo.id },
      data: {
        branchesFetchedAt: new Date(),
        ...(etag !== undefined ? { branchesEtag: etag } : {}),
        metadata: merged as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);
  logger.info(
    { owner, name, count: branches.length },
    'repo branches stored',
  );
}
