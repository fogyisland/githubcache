import { describe, it, expect, vi } from 'vitest';
import type { Repository } from '@prisma/client';

vi.mock('@/lib/db/repositories', () => ({
  findRepoByCanonical: vi.fn(),
}));

import { getRepoMetadata } from '@/lib/cache/read';
import { findRepoByCanonical } from '@/lib/db/repositories';

const mockRow = (overrides: Partial<Repository>): Repository =>
  ({
    id: 1n,
    owner: 'a',
    name: 'b',
    node: {},
    metadata: null,
    etag: null,
    lastFetchedAt: null,
    fetchStatus: 'ok',
    fetchError: null,
    createdAt: new Date(),
    ...overrides,
  }) as Repository;

describe('getRepoMetadata', () => {
  it('returns found=false on cache miss', async () => {
    vi.mocked(findRepoByCanonical).mockResolvedValueOnce(null);
    const r = await getRepoMetadata('a', 'b');
    expect(r.found).toBe(false);
  });

  it('returns found=true with metadata on cache hit (ok)', async () => {
    vi.mocked(findRepoByCanonical).mockResolvedValueOnce(
      mockRow({
        metadata: { stars: 1 },
        fetchStatus: 'ok',
        lastFetchedAt: new Date('2026-01-01'),
        etag: 'W/"x"',
      }),
    );
    const r = await getRepoMetadata('a', 'b');
    expect(r.found).toBe(true);
    if (r.found && r.fetchStatus !== 'not_found') {
      expect(r.fetchStatus).toBe('ok');
      expect(r.metadata).toEqual({ stars: 1 });
      expect(r.etag).toBe('W/"x"');
    }
  });

  it('returns found=true with metadata=null on not_found', async () => {
    vi.mocked(findRepoByCanonical).mockResolvedValueOnce(
      mockRow({ metadata: null, fetchStatus: 'not_found' }),
    );
    const r = await getRepoMetadata('a', 'b');
    expect(r.found).toBe(true);
    if (r.found && r.fetchStatus === 'not_found') {
      expect(r.metadata).toBeNull();
    }
  });
});
