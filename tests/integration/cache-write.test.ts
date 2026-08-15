import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import { storeRepoMetadata, getRepoMetadata } from '@/lib/cache';

describe('cache write+read round-trip', () => {
  afterAll(async () => {
    await prisma.repository.deleteMany({ where: { owner: 'test-owner' } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
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
