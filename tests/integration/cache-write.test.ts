import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import { storeRepoMetadata, getRepoMetadata } from '@/lib/cache';

describe('cache write+read round-trip', () => {
  afterAll(async () => {
    // M31 — RefreshJob no longer has a `repository` relation; owner/name
    // live on the row directly. The relation-based cleanup shape below
    // was deleted along with the FK in M31.
    await prisma.refreshJob.deleteMany({ where: { owner: 'test-owner' } });
    await prisma.repository.deleteMany({ where: { owner: 'test-owner' } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.refreshJob.deleteMany({ where: { owner: 'test-owner' } });
    await prisma.repository.deleteMany({ where: { owner: 'test-owner' } });
  });

  it('upserts then reads back via getRepoMetadata', async () => {
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'test-repo',
      node: { id: 1, name: 'test-repo' },
      metadata: { stars: 42 },
      fetchStatus: 'ok',
    });
    const r = await getRepoMetadata('test-owner', 'test-repo');
    expect(r.found).toBe(true);
    if (r.found && r.fetchStatus !== 'not_found') {
      expect(r.metadata).toEqual({ stars: 42 });
    }
  });

  it('upsert updates existing row without creating duplicate', async () => {
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'test-repo-2',
      node: { id: 1 },
      metadata: { stars: 1 },
      fetchStatus: 'ok',
    });
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'test-repo-2',
      node: { id: 1 },
      metadata: { stars: 2 },
      fetchStatus: 'ok',
    });
    const all = await prisma.repository.findMany({
      where: { owner: 'test-owner', name: 'test-repo-2' },
    });
    expect(all).toHaveLength(1);
  });

  it('storeRepoMetadata with fetchStatus=not_found yields metadata=null on read', async () => {
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'gone',
      node: { id: 1 },
      metadata: null,
      fetchStatus: 'not_found',
    });
    const r = await getRepoMetadata('test-owner', 'gone');
    expect(r.found).toBe(true);
    if (r.found && r.fetchStatus === 'not_found') {
      expect(r.metadata).toBeNull();
    }
  });
});

describe('create-then-update (M31 split)', () => {
  // M31 — storeRepoMetadata now goes through findRepoByCanonical →
  // updateRepo on the second call instead of the original
  // prisma.repository.upsert. This block guards against regressions
  // where the update path accidentally creates a duplicate row
  // (e.g., if the new code path forgets the owner_name unique check)
  // or strips the second call's metadata on the way back into the
  // row.

  afterEach(async () => {
    await prisma.refreshJob.deleteMany({ where: { owner: 'test-owner' } });
    await prisma.repository.deleteMany({ where: { owner: 'test-owner' } });
  });

  it('two consecutive storeRepoMetadata calls yield exactly ONE row (no duplicate)', async () => {
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'split-test',
      node: { id: 100 },
      metadata: { stars: 1 },
      fetchStatus: 'ok',
    });
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'split-test',
      node: { id: 100 },
      metadata: { stars: 2 },
      fetchStatus: 'ok',
    });

    const all = await prisma.repository.findMany({
      where: { owner: 'test-owner', name: 'split-test' },
    });
    // M31 split: first call → createRepo; second call → updateRepo.
    // Must result in EXACTLY ONE row (the @@unique([owner, name])
    // constraint enforces this anyway, but the test guards against
    // the case where the new code path's updateRepo accidentally
    // blows up before the WHERE clause runs).
    expect(all).toHaveLength(1);
  });

  it('second call updates the row (metadata reflects the second call)', async () => {
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'split-test-2',
      node: { id: 200 },
      metadata: { stars: 50, forks: 5 },
      fetchStatus: 'ok',
    });
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'split-test-2',
      node: { id: 200 },
      metadata: { stars: 99, forks: 7 },
      fetchStatus: 'ok',
    });

    const row = await prisma.repository.findUnique({
      where: { owner_name: { owner: 'test-owner', name: 'split-test-2' } },
    });
    expect(row).not.toBeNull();
    // Second-call values must win — storeRepoMetadata spreads the
    // full baseData into updateRepo, not a partial set. M27.4 fixed
    // exactly this regression; this test guards the create-vs-update
    // split against re-introducing it.
    expect(row?.stars).toBe(99);
    expect(row?.forks).toBe(7);
  });

  it('second call with fetchStatus=not_found updates status without creating a new row', async () => {
    // First call: row exists, ok.
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'split-test-3',
      node: { id: 300 },
      metadata: { stars: 10 },
      fetchStatus: 'ok',
    });
    // Second call: same row, status flips to not_found.
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'split-test-3',
      node: { id: 300 },
      metadata: null,
      fetchStatus: 'not_found',
    });

    const all = await prisma.repository.findMany({
      where: { owner: 'test-owner', name: 'split-test-3' },
    });
    expect(all).toHaveLength(1);
    expect(all[0]?.fetchStatus).toBe('not_found');
  });
});
