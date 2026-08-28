import { prisma } from '@/lib/db/client';

interface CreateTestRepoOpts {
  owner: string;
  name: string;
  status: 'ok' | 'not_found' | 'error';
}

export async function createTestRepo(opts: CreateTestRepoOpts) {
  const repo = await prisma.repository.upsert({
    where: { owner_name: { owner: opts.owner, name: opts.name } },
    create: {
      owner: opts.owner,
      name: opts.name,
      node: { id: 1 },
      metadata: { hello: 1 },
      fetchStatus: opts.status,
      lastFetchedAt: new Date(),
    },
    update: { fetchStatus: opts.status, lastFetchedAt: new Date() },
  });
  return repo;
}
