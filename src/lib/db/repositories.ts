import { prisma } from '@/lib/db/client';
import type { Prisma, Repository } from '@prisma/client';

export const findRepoByCanonical = (owner: string, name: string): Promise<Repository | null> =>
  prisma.repository.findUnique({ where: { owner_name: { owner, name } } });

export const upsertRepo = (data: Prisma.RepositoryUncheckedCreateInput): Promise<Repository> => {
  const update: Prisma.RepositoryUncheckedUpdateInput = {};
  if (data.metadata !== undefined) update.metadata = data.metadata;
  if (data.etag !== undefined) update.etag = data.etag;
  if (data.lastFetchedAt !== undefined) update.lastFetchedAt = data.lastFetchedAt;
  if (data.fetchStatus !== undefined) update.fetchStatus = data.fetchStatus;
  update.fetchError = data.fetchError ?? null;
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

