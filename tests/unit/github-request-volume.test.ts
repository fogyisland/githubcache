import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import {
  recordGithubCall,
  loadGithubRequestVolume,
} from '@/lib/admin/github-request-volume';

/**
 * Integration tests for src/lib/admin/github-request-volume.ts.
 *
 * Same prisma + scoped-cleanup pattern as tests/unit/reports-queries.test.ts.
 * Each test scopes its seeded rows by occurredAt so we never collide with
 * concurrent runs or production-shaped rows.
 *
 * The loader's "fill zero-buckets" logic is the trickiest piece — we
 * assert it explicitly via the seeded cases below (rows on either side
 * of an hour boundary + a missing hour).
 */

async function truncateAllEvents(): Promise<void> {
  await prisma.githubRequestEvent.deleteMany({});
}

beforeAll(async () => {
  // Sanity: confirm the model is wired up.
  await prisma.$queryRaw`SELECT 1 FROM github_request_events LIMIT 0`;
});

beforeEach(async () => {
  await truncateAllEvents();
});

afterAll(async () => {
  await truncateAllEvents();
});

describe('recordGithubCall', () => {
  it('writes a row to github_request_events with the given endpoint, tokenId, statusCode', async () => {
    await recordGithubCall('core', BigInt(42), 200);
    const rows = await prisma.githubRequestEvent.findMany({ orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endpoint).toBe('core');
    expect(rows[0]!.tokenId).toBe(BigInt(42));
    expect(rows[0]!.statusCode).toBe(200);
  });

  it('accepts a null tokenId', async () => {
    await recordGithubCall('releases', null, 200);
    const rows = await prisma.githubRequestEvent.findMany({});
    expect(rows[0]!.tokenId).toBeNull();
    expect(rows[0]!.endpoint).toBe('releases');
  });

  it('writes multiple rows when called repeatedly', async () => {
    await recordGithubCall('core', BigInt(1), 200);
    await recordGithubCall('releases', BigInt(1), 200);
    await recordGithubCall('branches', BigInt(1), 200);
    const rows = await prisma.githubRequestEvent.findMany({});
    expect(rows).toHaveLength(3);
    const endpoints = new Set(rows.map((r) => r.endpoint));
    expect(endpoints).toEqual(new Set(['core', 'releases', 'branches']));
  });
});

describe('loadGithubRequestVolume', () => {
  it('returns 24 hourly zero-buckets when the table is empty', async () => {
    const now = new Date('2026-09-15T12:00:00Z');
    const buckets = await loadGithubRequestVolume('24h', now);
    expect(buckets).toHaveLength(24);
    for (const b of buckets) {
      expect(b.core).toBe(0);
      expect(b.releases).toBe(0);
      expect(b.branches).toBe(0);
    }
  });

  it('returns exactly 24 buckets even when now is mid-hour (current-hour bucket included)', async () => {
    // Regression: the loader used to walk from floor(since) to `now`
    // exclusive, which produced 25 buckets when `now` was mid-hour. The
    // contract is: 24 buckets ending at the hour containing `now`.
    const now = new Date('2026-09-15T12:34:56Z');
    const buckets = await loadGithubRequestVolume('24h', now);
    expect(buckets).toHaveLength(24);
    // The right-most bucket is the hour containing `now` (12:00).
    const last = buckets[buckets.length - 1]!;
    expect(last.hour.getUTCHours()).toBe(12);
    expect(last.hour.getUTCDate()).toBe(15);
  });

  it('returns 7 daily zero-buckets when the table is empty (7d window)', async () => {
    const now = new Date('2026-09-15T12:00:00Z');
    const buckets = await loadGithubRequestVolume('7d', now);
    expect(buckets).toHaveLength(7);
    for (const b of buckets) {
      expect(b.core).toBe(0);
      expect(b.releases).toBe(0);
      expect(b.branches).toBe(0);
    }
  });

  it('aggregates seeded rows into hourly buckets correctly across endpoints', async () => {
    // Seed 3 rows in the hour starting at 11:00 (now=12:00, so still in 24h window)
    const t11 = new Date('2026-09-15T11:15:00Z');
    const t11b = new Date('2026-09-15T11:45:00Z');
    const t10 = new Date('2026-09-15T10:30:00Z');
    await prisma.githubRequestEvent.createMany({
      data: [
        { endpoint: 'core', tokenId: BigInt(1), statusCode: 200, occurredAt: t11 },
        { endpoint: 'core', tokenId: BigInt(1), statusCode: 200, occurredAt: t11 },
        { endpoint: 'releases', tokenId: BigInt(1), statusCode: 200, occurredAt: t11 },
        { endpoint: 'branches', tokenId: BigInt(1), statusCode: 200, occurredAt: t11b },
        { endpoint: 'core', tokenId: BigInt(1), statusCode: 200, occurredAt: t10 },
      ],
    });
    const buckets = await loadGithubRequestVolume(
      '24h',
      new Date('2026-09-15T12:00:00Z'),
    );
    const hour11 = buckets.find(
      (b) => b.hour.getUTCHours() === 11 && b.hour.getUTCDate() === 15,
    );
    const hour10 = buckets.find(
      (b) => b.hour.getUTCHours() === 10 && b.hour.getUTCDate() === 15,
    );
    expect(hour11).toBeDefined();
    expect(hour11!.core).toBe(2);
    expect(hour11!.releases).toBe(1);
    expect(hour11!.branches).toBe(1);
    expect(hour10).toBeDefined();
    expect(hour10!.core).toBe(1);
    expect(hour10!.releases).toBe(0);
    expect(hour10!.branches).toBe(0);
  });

  it('hour-boundary: rows at HH:59:59 vs HH:00:00 land in different buckets', async () => {
    // 23:59:59 on day N belongs to bucket starting at 23:00
    // 00:00:00 on day N+1 belongs to bucket starting at 00:00
    await prisma.githubRequestEvent.createMany({
      data: [
        { endpoint: 'core', tokenId: null, statusCode: 200, occurredAt: new Date('2026-09-14T23:59:59Z') },
        { endpoint: 'core', tokenId: null, statusCode: 200, occurredAt: new Date('2026-09-15T00:00:00Z') },
      ],
    });
    const buckets = await loadGithubRequestVolume(
      '24h',
      new Date('2026-09-15T12:00:00Z'),
    );
    const total = buckets.reduce((a, b) => a + b.core, 0);
    expect(total).toBe(2);
  });

  it('fills missing hours with zeros so the X-axis is complete', async () => {
    // Seed only 1 row at hour 5; other hours in the 24h window should be 0
    await prisma.githubRequestEvent.create({
      data: {
        endpoint: 'core',
        tokenId: BigInt(1),
        statusCode: 200,
        occurredAt: new Date('2026-09-15T05:30:00Z'),
      },
    });
    const buckets = await loadGithubRequestVolume(
      '24h',
      new Date('2026-09-15T12:00:00Z'),
    );
    expect(buckets).toHaveLength(24);
    const nonZero = buckets.filter((b) => b.core > 0);
    expect(nonZero).toHaveLength(1);
    expect(nonZero[0]!.hour.getUTCHours()).toBe(5);
  });

  it('excludes rows older than 24h in the 24h window', async () => {
    await prisma.githubRequestEvent.createMany({
      data: [
        { endpoint: 'core', tokenId: null, statusCode: 200, occurredAt: new Date('2026-09-15T11:00:00Z') }, // in window
        { endpoint: 'core', tokenId: null, statusCode: 200, occurredAt: new Date('2026-09-13T11:00:00Z') }, // out (2 days ago)
      ],
    });
    const buckets = await loadGithubRequestVolume(
      '24h',
      new Date('2026-09-15T12:00:00Z'),
    );
    const total = buckets.reduce((a, b) => a + b.core, 0);
    expect(total).toBe(1);
  });

  it('7d window includes rows up to 7 days back', async () => {
    await prisma.githubRequestEvent.createMany({
      data: [
        { endpoint: 'core', tokenId: null, statusCode: 200, occurredAt: new Date('2026-09-15T11:00:00Z') }, // in
        { endpoint: 'core', tokenId: null, statusCode: 200, occurredAt: new Date('2026-09-09T12:00:00Z') }, // 6d ago, in
        { endpoint: 'core', tokenId: null, statusCode: 200, occurredAt: new Date('2026-09-08T00:00:00Z') }, // 7+ days ago, out
      ],
    });
    const buckets = await loadGithubRequestVolume(
      '7d',
      new Date('2026-09-15T12:00:00Z'),
    );
    expect(buckets).toHaveLength(7);
    const total = buckets.reduce((a, b) => a + b.core, 0);
    expect(total).toBe(2);
  });
});
