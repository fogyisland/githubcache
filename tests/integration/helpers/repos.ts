import { prisma } from '@/lib/db/client';

interface CreateTestRepoOpts {
  owner: string;
  name: string;
  status: 'ok' | 'not_found' | 'error';
}

const DEFAULT_METADATA = {
  owner: '',
  name: '',
  stars: 2000,
  forks: 900,
  watchers: 80,
  language: 'TypeScript',
  defaultBranch: 'main',
  homepage: 'https://example.com',
  description: 'A test repository',
  topics: ['test', 'example'],
  license: 'MIT',
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  pushed_at: '2024-01-15T00:00:00Z',
};

export async function createTestRepo(opts: CreateTestRepoOpts) {
  const metadata = { ...DEFAULT_METADATA, owner: opts.owner, name: opts.name };
  const repo = await prisma.repository.upsert({
    where: { owner_name: { owner: opts.owner, name: opts.name } },
    create: {
      owner: opts.owner,
      name: opts.name,
      node: { id: 1 },
      metadata,
      fetchStatus: opts.status,
      lastFetchedAt: new Date(),
    },
    update: { fetchStatus: opts.status, lastFetchedAt: new Date(), metadata },
  });
  return repo;
}
