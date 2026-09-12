import { describe, it, expect } from 'vitest';
import { estimateExpectedAt } from '@/lib/cache/eta';

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
