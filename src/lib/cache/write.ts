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
  const row = await upsertRepo({
    owner: args.owner,
    name: args.name,
    node: args.node as Prisma.InputJsonValue,
    metadata: args.metadata as Prisma.InputJsonValue,
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
