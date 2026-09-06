import type { Prisma, Repository } from '@prisma/client';
import type { FetchStatus } from '@prisma/client';
import { upsertRepo } from '@/lib/db/repositories';
import { logger } from '@/lib/logger';

export async function storeRepoMetadata(args: {
  owner: string;
  name: string;
  node: unknown;
  metadata: unknown;
  etag?: string;
  fetchStatus: FetchStatus;
  fetchError?: string;
}): Promise<Repository> {
  // M27 — pull defaultBranch from the metadata blob so the new
  // `defaultBranch` column gets populated on first write. M27.2
  // backfills existing rows; new writes are correct from day one.
  const md = args.metadata as { defaultBranch?: string } | null;
  const row = await upsertRepo({
    owner: args.owner,
    name: args.name,
    node: args.node as Prisma.InputJsonValue,
    metadata: args.metadata as Prisma.InputJsonValue,
    defaultBranch: md?.defaultBranch ?? 'main',
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
