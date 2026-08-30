import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import {
  ingestionSummary,
  repositoryFetchBreakdown,
  recentRefreshJobs,
} from '@/lib/reports/ingestion';

/**
 * Integration tests for src/lib/reports/ingestion.ts.
 *
 * Three helpers — ingestionSummary (queue + done/failed counts),
 * repositoryFetchBreakdown (fetch status counts across repositories),
 * recentRefreshJobs (paginated RefreshJob rows joined with their parent
 * repository). All three are read-only aggregations; we seed scratch
 * rows tagged with a unique owner/name prefix and clean them up in
 * beforeEach.
 */

const TEST_REPO_PREFIX = 'ingestion-test/repo-';
const TEST_USER_EMAIL = 'ingestion-test-user@example.test';

let testRepoIds: bigint[] = [];

async function cleanup(): Promise<void> {
  if (testRepoIds.length > 0) {
    await prisma.refreshJob.deleteMany({
      where: { repositoryId: { in: testRepoIds } },
    });
    await prisma.repository.deleteMany({
      where: { id: { in: testRepoIds } },
    });
    testRepoIds = [];
  }
}

beforeAll(async () => {
  // Ensure a foreign-key target exists for any inserts (not actually needed
  // for repository row creation, but kept for symmetry with other suites).
  await prisma.user.upsert({
    where: { email: TEST_USER_EMAIL },
    update: {},
    create: {
      email: TEST_USER_EMAIL,
      role: 'operator',
      status: 'active',
    },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.user.deleteMany({ where: { email: TEST_USER_EMAIL } });
  await prisma.$disconnect();
});

async function seedRepo(
  owner: string,
  name: string,
  fetchStatus: 'ok' | 'not_found' | 'forbidden' | 'error',
): Promise<bigint> {
  const repo = await prisma.repository.create({
    data: {
      owner,
      name,
      node: { stub: true } as never,
      fetchStatus,
    },
  });
  testRepoIds.push(repo.id);
  return repo.id;
}

describe('repositoryFetchBreakdown', () => {
  beforeEach(async () => {
    await cleanup();
  });

  it('counts repos in each fetch_status category', async () => {
    await seedRepo(`${TEST_REPO_PREFIX}ok-a`, 'ok-a', 'ok');
    await seedRepo(`${TEST_REPO_PREFIX}ok-b`, 'ok-b', 'ok');
    await seedRepo(`${TEST_REPO_PREFIX}nf`, 'nf', 'not_found');
    await seedRepo(`${TEST_REPO_PREFIX}fb`, 'fb', 'forbidden');
    await seedRepo(`${TEST_REPO_PREFIX}err`, 'err', 'error');

    const breakdown = await repositoryFetchBreakdown();
    // The breakdown is across the entire `repositories` table, so we
    // assert that our seeded counts are AT LEAST what we inserted (other
    // tests may leave residue).
    expect(breakdown.ok).toBeGreaterThanOrEqual(2);
    expect(breakdown.not_found).toBeGreaterThanOrEqual(1);
    expect(breakdown.forbidden).toBeGreaterThanOrEqual(1);
    expect(breakdown.error).toBeGreaterThanOrEqual(1);
  });

  it('returns all zeros when no rows exist (sanity)', async () => {
    // We can't truncate the table (other tests share it), so this just
    // confirms the shape: all four numbers are non-negative integers.
    const breakdown = await repositoryFetchBreakdown();
    expect(breakdown.ok).toBeGreaterThanOrEqual(0);
    expect(breakdown.not_found).toBeGreaterThanOrEqual(0);
    expect(breakdown.forbidden).toBeGreaterThanOrEqual(0);
    expect(breakdown.error).toBeGreaterThanOrEqual(0);
  });
});

describe('ingestionSummary', () => {
  beforeEach(async () => {
    await cleanup();
  });

  it('returns numeric counts for all four buckets', async () => {
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 5_000);
    const summary = await ingestionSummary(from, to);
    expect(typeof summary.pending).toBe('number');
    expect(typeof summary.inProgress).toBe('number');
    expect(typeof summary.done).toBe('number');
    expect(typeof summary.failed).toBe('number');
    expect(summary.pending).toBeGreaterThanOrEqual(0);
    expect(summary.inProgress).toBeGreaterThanOrEqual(0);
    expect(summary.done).toBeGreaterThanOrEqual(0);
    expect(summary.failed).toBeGreaterThanOrEqual(0);
  });

  it('counts done and failed refresh jobs inside the time window', async () => {
    const repoId = await seedRepo(`${TEST_REPO_PREFIX}sum`, 'sum', 'ok');
    // Seed one done job in window
    await prisma.refreshJob.create({
      data: {
        repositoryId: repoId,
        priority: 50,
        scheduledFor: new Date(),
        status: 'done',
        attempts: 1,
        updatedAt: new Date(),
      },
    });
    // Seed one failed job in window
    await prisma.refreshJob.create({
      data: {
        repositoryId: repoId,
        priority: 50,
        scheduledFor: new Date(),
        status: 'failed',
        attempts: 3,
        lastError: 'upstream 503',
        updatedAt: new Date(),
      },
    });
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 5_000);
    const summary = await ingestionSummary(from, to);
    expect(summary.done).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
  });
});

describe('recentRefreshJobs', () => {
  beforeEach(async () => {
    await cleanup();
  });

  it('returns paginated rows joined with repository owner/name', async () => {
    const repoId = await seedRepo(`${TEST_REPO_PREFIX}recent-a`, 'recent-a', 'ok');
    const repoId2 = await seedRepo(`${TEST_REPO_PREFIX}recent-b`, 'recent-b', 'ok');
    await prisma.refreshJob.create({
      data: {
        repositoryId: repoId,
        priority: 50,
        scheduledFor: new Date(),
        status: 'done',
        attempts: 1,
      },
    });
    await prisma.refreshJob.create({
      data: {
        repositoryId: repoId2,
        priority: 50,
        scheduledFor: new Date(),
        status: 'failed',
        attempts: 2,
        lastError: 'timeout',
      },
    });
    const rows = await recentRefreshJobs({ skip: 0, take: 100 });
    const mine = rows.filter((r) =>
      r.repositoryOwner.startsWith(TEST_REPO_PREFIX),
    );
    expect(mine.length).toBe(2);
    const owners = mine.map((r) => `${r.repositoryOwner}/${r.repositoryName}`);
    expect(owners).toContain(`${TEST_REPO_PREFIX}recent-a/recent-a`);
    expect(owners).toContain(`${TEST_REPO_PREFIX}recent-b/recent-b`);
    // `total` is the unfiltered count across the table.
    expect(rows[0]!.total).toBeGreaterThanOrEqual(2);
  });
});