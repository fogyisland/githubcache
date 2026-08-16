import { describe, it, expect, beforeEach } from 'vitest';
import { tokenBucket, __resetAllBucketsForTests } from '@/lib/rate-limit/memory';

describe('tokenBucket', () => {
  beforeEach(() => {
    __resetAllBucketsForTests();
  });

  it('first allow returns true', () => {
    const b = tokenBucket('key-a', 5);
    expect(b.allow()).toBe(true);
  });

  it('allows up to perMinute calls', () => {
    const b = tokenBucket('key-b', 3);
    expect(b.allow()).toBe(true);
    expect(b.allow()).toBe(true);
    expect(b.allow()).toBe(true);
    expect(b.allow()).toBe(false);
  });

  it('counts are per-key (independent buckets)', () => {
    const a = tokenBucket('key-c', 2);
    const d = tokenBucket('key-d', 2);
    expect(a.allow()).toBe(true);
    expect(a.allow()).toBe(true);
    expect(a.allow()).toBe(false);
    expect(d.allow()).toBe(true);
    expect(d.allow()).toBe(true);
    expect(d.allow()).toBe(false);
  });

  it('reset clears the bucket so the key can allow again', () => {
    const b = tokenBucket('key-e', 1);
    expect(b.allow()).toBe(true);
    expect(b.allow()).toBe(false);
    b.reset();
    expect(b.allow()).toBe(true);
  });

  it('window resets after 60s (simulated via Date.now mock)', () => {
    const realNow = Date.now;
    let mockNow = 1_000_000;
    Date.now = () => mockNow;
    try {
      const b = tokenBucket('key-f', 1);
      expect(b.allow()).toBe(true);
      expect(b.allow()).toBe(false);
      mockNow += 60_001;
      expect(b.allow()).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });
});