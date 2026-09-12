import { describe, it, expect, vi } from 'vitest';
import { estimateExpectedAt } from '@/lib/cache/eta';
import { lookupRepo } from '@/lib/cache/lookup';

// Mock @/lib/db/client so lookupRepo's plumbing test doesn't touch a real DB.
// Task 1's pure tests don't import @/lib/cache/lookup, so they're unaffected
// by this mock — vi.mock is hoisted per file and only fires when @/lib/db/client
// is actually resolved by lookupRepo's import graph.
vi.mock('@/lib/db/client', () => {
  const upsert = vi.fn().mockResolvedValue({ id: 999n });
  const findFirst = vi.fn().mockResolvedValue(null); // no existing pending
  const create = vi.fn().mockResolvedValue({ id: 1n });
  // M31.1 — enqueueRefresh now calls prisma.$transaction (Serializable
  // isolation) instead of two top-level calls. The mock passes the
  // transaction body a tx object whose findFirst/create resolve the
  // same as the top-level mocks, so the test exercises the new path
  // without touching a real DB.
  const $transaction = vi.fn().mockImplementation(async (fn) => {
    const tx = {
      refreshJob: { findFirst, create },
    };
    return fn(tx);
  });
  return {
    prisma: {
      repository: { upsert },
      refreshJob: {
        count: vi.fn().mockResolvedValue(2),
        findFirst,
        create,
      },
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ median_ms: 7000 }]),
      $transaction,
    },
  };
});

// Stub @/lib/cache/read so lookupRepo takes the enqueue path (cache miss).
vi.mock('@/lib/cache/read', () => ({
  getRepoMetadata: vi.fn().mockResolvedValue({ found: false }),
}));

// @/lib/db/repositories is transitively imported by lookup — stub it.
vi.mock('@/lib/db/repositories', () => ({}));

describe('estimateExpectedAt', () => {
  const NOW = new Date('2026-09-12T12:00:00.000Z');

  it('1) empty queue + known median returns now + tick', () => {
    const r = estimateExpectedAt({
      queueDepth: 1, tickMs: 60_000, batchSize: 10, medianFetchMs: 5_000, now: NOW,
    });
    // queue 1 of 10 fits in current tick → + tick + fetch
    expect(r.toISOString()).toBe('2026-09-12T12:01:05.000Z');
  });

  it('2) full batch ahead pushes ETA to next tick + median', () => {
    const r = estimateExpectedAt({
      queueDepth: 10, tickMs: 60_000, batchSize: 10, medianFetchMs: 5_000, now: NOW,
    });
    // queue 10 in batch 10 → this batch is full, ours is next → + 2 ticks + median
    expect(r.toISOString()).toBe('2026-09-12T12:02:05.000Z');
  });

  it('3) 21-deep queue spans 3 batches → + 3 ticks + median', () => {
    const r = estimateExpectedAt({
      queueDepth: 21, tickMs: 60_000, batchSize: 10, medianFetchMs: 5_000, now: NOW,
    });
    expect(r.toISOString()).toBe('2026-09-12T12:03:05.000Z');
  });

  it('4) medianFetchMs=0 falls back to 2 ticks', () => {
    const r = estimateExpectedAt({
      queueDepth: 1, tickMs: 60_000, batchSize: 10, medianFetchMs: 0, now: NOW,
    });
    expect(r.toISOString()).toBe('2026-09-12T12:02:00.000Z');
  });

  it('5) batchSize=1 with queueDepth=3 → + 3 ticks + median', () => {
    const r = estimateExpectedAt({
      queueDepth: 3, tickMs: 1_000, batchSize: 1, medianFetchMs: 100, now: NOW,
    });
    expect(r.toISOString()).toBe('2026-09-12T12:00:03.100Z');
  });

  it('6) result Date object — not string', () => {
    const r = estimateExpectedAt({
      queueDepth: 1, tickMs: 60_000, batchSize: 10, medianFetchMs: 0, now: NOW,
    });
    expect(r).toBeInstanceOf(Date);
  });
});

describe('lookupRepo plumbing', () => {
  it('7) pending result has expectedAt > queuedAt and the two new fields', async () => {
    const r = await lookupRepo('owner', 'name');
    if (r.fetch_status !== 'pending') throw new Error('expected pending');
    const queuedAt = new Date(r.queuedAt);
    const expectedAt = new Date(r.expectedAt);
    expect(expectedAt.getTime()).toBeGreaterThan(queuedAt.getTime());
    expect(typeof r.schedulerTickMs).toBe('number');
    expect(r.schedulerTickMs).toBeGreaterThan(0);
    expect(typeof r.schedulerBatchSize).toBe('number');
    expect(r.schedulerBatchSize).toBeGreaterThan(0);
  });
});