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
  // M20.8 — version + branch fields. Test fixtures default to "no releases,
  // no branches" unless a specific test overrides these.
  latestRelease: null,
  recentReleases: [],
  releaseCount: 0,
  branches: [],
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
      // M27 — write the typed columns too so the new read path
      // (M27.3) has data to return when the flag is on.
      description: metadata.description,
      private: metadata.private,
      defaultBranch: metadata.defaultBranch,
      stars: metadata.stars,
      forks: metadata.forks,
      watchers: metadata.watchers,
      language: metadata.language,
      license: metadata.license,
      topics: metadata.topics as unknown as Prisma.InputJsonValue,
      homepage: metadata.homepage,
      archived: metadata.archived,
      disabled: metadata.disabled,
      repoCreatedAt: metadata.createdAt ? new Date(metadata.createdAt) : null,
      repoUpdatedAt: metadata.updatedAt ? new Date(metadata.updatedAt) : null,
      repoPushedAt: metadata.pushedAt ? new Date(metadata.pushedAt) : null,
    },
    update: {
      fetchStatus: opts.status,
      lastFetchedAt: new Date(),
      metadata: jsonMetadata,
      // M27 — mirror metadata into typed columns so the new read
      // path (M27.3) returns the same values regardless of the flag.
      description: metadata.description,
      private: metadata.private,
      defaultBranch: metadata.defaultBranch,
      stars: metadata.stars,
      forks: metadata.forks,
      watchers: metadata.watchers,
      language: metadata.language,
      license: metadata.license,
      topics: metadata.topics as unknown as Prisma.InputJsonValue,
      homepage: metadata.homepage,
      archived: metadata.archived,
      disabled: metadata.disabled,
      repoCreatedAt: metadata.createdAt ? new Date(metadata.createdAt) : null,
      repoUpdatedAt: metadata.updatedAt ? new Date(metadata.updatedAt) : null,
      repoPushedAt: metadata.pushedAt ? new Date(metadata.pushedAt) : null,
    },
  });
  return repo;
}
