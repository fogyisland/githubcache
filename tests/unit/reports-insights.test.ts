import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import {
  topRepos,
  languageDistribution,
  distinctLanguages,
  staleRepos,
  fetchStatusBreakdown,
  recentFetchFailures,
  isInsightsSortKey,
} from '@/lib/reports/insights';

/**
 * Integration tests for src/lib/reports/insights.ts (M18).
 *
 * All five helpers are read-only aggregations over the `repositories`
 * table. We seed scratch repos tagged with a unique `insights-test/...`
 * owner/name prefix and clean them up in beforeEach. Metadata blobs are
 * inserted as JSON objects via `metadata:` so the JSON_EXTRACT paths in
 * the helpers have real values to extract from.
 */

const TEST_OWNER_PREFIX = 'insights-test';

interface SeedMetadata {
  stars?: number;
  forks?: number;
  watchers?: number;
  language?: string;
  license?: string;
  updatedAt?: string;
}

async function seedRepo(
  name: string,
  fetchStatus: 'ok' | 'not_found' | 'forbidden' | 'error',
  metadata: SeedMetadata | null,
  options?: { lastFetchedAt?: Date | null; fetchError?: string | null },
): Promise<bigint> {
  const repo = await prisma.repository.create({
    data: {
      owner: TEST_OWNER_PREFIX,
      name,
      // `node` is required (non-null JSON column); supply a stub.
      node: { stub: true } as never,
      fetchStatus,
      metadata: (metadata ?? undefined) as never,
      lastFetchedAt: options?.lastFetchedAt ?? null,
      fetchError: options?.fetchError ?? null,
    },
  });
  testRepoIds.push(repo.id);
  return repo.id;
}

const testRepoIds: bigint[] = [];

async function cleanup(): Promise<void> {
  if (testRepoIds.length > 0) {
    await prisma.repository.deleteMany({
      where: { id: { in: testRepoIds } },
    });
    testRepoIds.length = 0;
  }
}

beforeAll(async () => {
  // Nothing DB-wide to seed — repository rows stand alone.
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('isInsightsSortKey', () => {
  it('accepts the documented sort keys', () => {
    expect(isInsightsSortKey('stars')).toBe(true);
    expect(isInsightsSortKey('forks')).toBe(true);
    expect(isInsightsSortKey('watchers')).toBe(true);
    expect(isInsightsSortKey('updated_at')).toBe(true);
    expect(isInsightsSortKey('last_fetched_at')).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isInsightsSortKey('open_issues')).toBe(false);
    expect(isInsightsSortKey('')).toBe(false);
    expect(isInsightsSortKey(null)).toBe(false);
    expect(isInsightsSortKey(undefined)).toBe(false);
    expect(isInsightsSortKey(42)).toBe(false);
  });
});

describe('topRepos', () => {
  beforeEach(async () => {
    await cleanup();
  });

  it('returns rows sorted by stars descending by default', async () => {
    await seedRepo('stars-low', 'ok', { stars: 5, forks: 1, language: 'TypeScript' });
    await seedRepo('stars-high', 'ok', { stars: 9_999, forks: 100, language: 'TypeScript' });
    await seedRepo('stars-mid', 'ok', { stars: 100, forks: 10, language: 'TypeScript' });

    const result = await topRepos({ skip: 0, take: 50 });

    const ours = result.rows.filter((r) => r.owner === TEST_OWNER_PREFIX);
    expect(ours.length).toBe(3);
    expect(ours.map((r) => r.name)).toEqual([
      'stars-high',
      'stars-mid',
      'stars-low',
    ]);
    expect(ours[0]!.stars).toBe(9_999);
    expect(result.sortBy).toBe('stars');
  });

  it('switches to forks ordering when requested', async () => {
    await seedRepo('more-stars', 'ok', { stars: 500, forks: 1 });
    await seedRepo('more-forks', 'ok', { stars: 5, forks: 200 });

    const result = await topRepos({ skip: 0, take: 50, sortBy: 'forks' });
    const ours = result.rows.filter((r) => r.owner === TEST_OWNER_PREFIX);

    expect(ours[0]!.name).toBe('more-forks');
    expect(ours[0]!.forks).toBe(200);
    expect(result.sortBy).toBe('forks');
  });

  it('applies the language filter when provided', async () => {
    await seedRepo('ts-1', 'ok', { stars: 100, language: 'TypeScript' });
    await seedRepo('go-1', 'ok', { stars: 200, language: 'Go' });
    await seedRepo('rust-1', 'ok', { stars: 300, language: 'Rust' });

    const result = await topRepos({
      skip: 0,
      take: 50,
      sortBy: 'stars',
      language: 'Go',
    });

    const ours = result.rows.filter((r) => r.owner === TEST_OWNER_PREFIX);
    expect(ours.length).toBe(1);
    expect(ours[0]!.name).toBe('go-1');
    expect(result.language).toBe('Go');
  });

  it('excludes not_found / forbidden / error repos', async () => {
    await seedRepo('status-ok', 'ok', { stars: 100 });
    await seedRepo('status-404', 'not_found', { stars: 999 });
    await seedRepo('status-403', 'forbidden', { stars: 999 });
    await seedRepo('status-err', 'error', { stars: 999 });

    const result = await topRepos({ skip: 0, take: 50 });
    const ours = result.rows.filter((r) => r.owner === TEST_OWNER_PREFIX);
    expect(ours.length).toBe(1);
    expect(ours[0]!.name).toBe('status-ok');
  });
});

describe('languageDistribution + distinctLanguages', () => {
  beforeEach(async () => {
    await cleanup();
  });

  it('groups ok repos by language and sorts by count desc', async () => {
    // Capture baseline counts because the test DB may contain rows from
    // other suites sharing the same MySQL instance.
    const before = await languageDistribution(100);
    const baseTs = before.find((b) => b.key === 'TypeScript')?.count ?? 0;
    const baseGo = before.find((b) => b.key === 'Go')?.count ?? 0;
    const baseRust = before.find((b) => b.key === 'Rust')?.count ?? 0;

    await seedRepo('ts-a', 'ok', { language: 'TypeScript' });
    await seedRepo('ts-b', 'ok', { language: 'TypeScript' });
    await seedRepo('ts-c', 'ok', { language: 'TypeScript' });
    await seedRepo('go-a', 'ok', { language: 'Go' });
    await seedRepo('rust-a', 'ok', { language: 'Rust' });

    const after = await languageDistribution(100);
    const ts = after.find((b) => b.key === 'TypeScript');
    const go = after.find((b) => b.key === 'Go');
    const rust = after.find((b) => b.key === 'Rust');

    expect(ts).toBeDefined();
    expect(go).toBeDefined();
    expect(rust).toBeDefined();
    expect(ts!.count - baseTs).toBe(3);
    expect(go!.count - baseGo).toBe(1);
    expect(rust!.count - baseRust).toBe(1);

    // Distinct languages list includes ours.
    const langs = await distinctLanguages();
    expect(langs).toContain('TypeScript');
    expect(langs).toContain('Go');
    expect(langs).toContain('Rust');
  });

  it('skips empty-language rows', async () => {
    await seedRepo('no-lang', 'ok', { stars: 1 });

    const dist = await languageDistribution(50);
    const ours = dist.filter((b) => b.count > 0 && b.key === '');
    expect(ours.length).toBe(0);
  });
});

describe('staleRepos', () => {
  beforeEach(async () => {
    await cleanup();
  });

  it('returns repos older than the threshold, oldest first', async () => {
    const now = Date.now();
    const old = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const veryOld = new Date(now - 90 * 24 * 60 * 60 * 1000);
    const recent = new Date(now - 1 * 24 * 60 * 60 * 1000);

    await seedRepo('very-old', 'ok', { stars: 1 }, { lastFetchedAt: veryOld });
    await seedRepo('old', 'ok', { stars: 1 }, { lastFetchedAt: old });
    await seedRepo('recent', 'ok', { stars: 1 }, { lastFetchedAt: recent });

    const result = await staleRepos({ thresholdDays: 7, skip: 0, take: 50 });
    const ours = result.rows.filter((r) => r.owner === TEST_OWNER_PREFIX);

    expect(ours.map((r) => r.name)).toEqual(['very-old', 'old']);
    expect(ours[0]!.ageDays).toBeGreaterThanOrEqual(89);
    expect(result.thresholdDays).toBe(7);
  });

  it('excludes repos with NULL last_fetched_at', async () => {
    await seedRepo('never-fetched', 'ok', { stars: 1 }, { lastFetchedAt: null });

    const result = await staleRepos({ thresholdDays: 1, skip: 0, take: 50 });
    const ours = result.rows.filter((r) => r.owner === TEST_OWNER_PREFIX);
    expect(ours.length).toBe(0);
  });
});

describe('fetchStatusBreakdown', () => {
  beforeEach(async () => {
    await cleanup();
  });

  it('reports counts grouped by fetch_status', async () => {
    // We can't assert the global totals (other suites seed rows too),
    // but we can assert our contributions are visible in the slice.
    await seedRepo('ok-row', 'ok', { stars: 1 });
    await seedRepo('404-row', 'not_found', null);
    await seedRepo('err-row', 'error', null);

    const breakdown = await fetchStatusBreakdown();
    expect(breakdown.ok).toBeGreaterThanOrEqual(1);
    expect(breakdown.not_found).toBeGreaterThanOrEqual(1);
    expect(breakdown.error).toBeGreaterThanOrEqual(1);
  });
});

describe('recentFetchFailures', () => {
  beforeEach(async () => {
    await cleanup();
  });

  it('returns repos in non-OK fetch_status, most-recent first', async () => {
    const now = Date.now();
    const older = new Date(now - 5 * 60 * 1000);
    const newer = new Date(now - 60 * 1000);

    await seedRepo('fail-newer', 'error', null, { lastFetchedAt: newer });
    await seedRepo('fail-older', 'not_found', null, { lastFetchedAt: older });
    await seedRepo('ok-row', 'ok', { stars: 1 }, { lastFetchedAt: newer });

    const result = await recentFetchFailures({ skip: 0, take: 50 });
    const ours = result.rows.filter((r) => r.owner === TEST_OWNER_PREFIX);

    expect(ours.map((r) => r.name)).toEqual(['fail-newer', 'fail-older']);
    expect(ours[0]!.fetchStatus).toBe('error');
    expect(ours[1]!.fetchStatus).toBe('not_found');
  });
});
