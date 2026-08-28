import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';
import type { RepoCoreData } from '@/lib/github/fields';

interface CreateTestRepoOpts {
  owner: string;
  name: string;
  status: 'ok' | 'not_found' | 'error';
}

// Default metadata for a cached 'ok' repo. Mirrors RepoCoreData from
// src/lib/github/fields.ts exactly — no `owner` (the owner lives only
// in the URL path / canonical key, never in the cached metadata) and
// camelCase date fields. Keeping the shape aligned with parseRepoResponse
// means the test cannot silently drift from production.
const DEFAULT_METADATA: RepoCoreData = {
  name: '',
  description: 'A test repository',
  private: false,
  defaultBranch: 'main',
  stars: 123,
  forks: 900,
  watchers: 80,
  createdAt: '2020-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  pushedAt: '2024-01-15T00:00:00Z',
  language: 'TypeScript',
  license: 'MIT',
  topics: ['test', 'example'],
  homepage: 'https://example.com',
  archived: false,
  disabled: false,
};

export async function createTestRepo(opts: CreateTestRepoOpts) {
  const metadata: RepoCoreData = { ...DEFAULT_METADATA, name: opts.name };
  const jsonMetadata = metadata as unknown as Prisma.InputJsonValue;
  const repo = await prisma.repository.upsert({
    where: { owner_name: { owner: opts.owner, name: opts.name } },
    create: {
      owner: opts.owner,
      name: opts.name,
      node: { id: 1 },
      metadata: jsonMetadata,
      fetchStatus: opts.status,
      lastFetchedAt: new Date(),
    },
    update: { fetchStatus: opts.status, lastFetchedAt: new Date(), metadata: jsonMetadata },
  });
  return repo;
}
