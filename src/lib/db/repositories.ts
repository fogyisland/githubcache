import { prisma } from '@/lib/db/client';
import type { FetchStatus, Prisma, Repository } from '@prisma/client';

export const findRepoByCanonical = (owner: string, name: string): Promise<Repository | null> =>
  prisma.repository.findUnique({ where: { owner_name: { owner, name } } });

export const upsertRepo = (data: Prisma.RepositoryUncheckedCreateInput): Promise<Repository> => {
  // M27.4 fix — propagate the full set of fields on UPDATE, not just the
  // 5 the original code carried. The cache-miss → enqueue path creates a
  // stub row via `lookup.ts → enqueueRefresh`, then the scheduler fetch
  // calls `storeRepoMetadata → upsertRepo` which hits the UPDATE branch.
  // Without forwarding the flat columns (`stars`, `forks`, `description`,
  // `language`, `topics`, …), the post-fetch row stays at the stub's
  // defaults (all 0 / null) and the indexed-column reads in
  // `cache/read.ts` always return zeros.
  //
  // We forward every field that is present in `data`. The CREATE branch
  // uses `data` directly (it has every column set, including the
  // defaults from `storeRepoMetadata`'s defensive extraction).
  const update: Prisma.RepositoryUncheckedUpdateInput = data;
  return prisma.repository.upsert({
    where: { owner_name: { owner: data.owner, name: data.name } },
    create: data,
    update,
  });
};

/**
 * Top N most-recently-fetched 'ok' repositories. Used by the homepage
 * recent-lookups list (M9.5). Skips not_found / forbidden / error rows
 * since those would be misleading as "recently browsed" entries.
 */
export const recentLookups = (limit: number): Promise<Repository[]> =>
  prisma.repository.findMany({
    where: { fetchStatus: 'ok', lastFetchedAt: { not: null } },
    orderBy: { lastFetchedAt: 'desc' },
    take: limit,
  });

// -----------------------------------------------------------------------------
// M23.x — admin SPA: paginated list of imported nodes with optional status
// filter. Powers /admin/repositories (the "已入库节点" page). Newest-fetched
// first; rows with `lastFetchedAt IS NULL` (never successfully fetched) sort
// last via the { sort: 'desc', nulls: 'last' } ordering.
// -----------------------------------------------------------------------------

export async function listRepositories(opts: {
  fetchStatus?: FetchStatus;
  skip: number;
  take: number;
}): Promise<{ rows: Repository[]; total: number }> {
  const where: Prisma.RepositoryWhereInput = {};
  if (opts.fetchStatus) where.fetchStatus = opts.fetchStatus;
  const [rows, total] = await Promise.all([
    prisma.repository.findMany({
      where,
      orderBy: { lastFetchedAt: { sort: 'desc', nulls: 'last' } },
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.repository.count({ where }),
  ]);
  return { rows, total };
}

