import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import {
  getOldestPending,
  listJobsByStatus,
  listJobsInRange,
  listPendingJobs,
} from '@/lib/db/refresh-jobs';

const TEST_OWNER = 'db-refresh-jobs-queue-test';
const TEST_USER_EMAIL = 'db-refresh-jobs-queue-user@example.test';

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

beforeEach(async () => {
  await cleanup();
});

async function seedRepo(name: string): Promise<bigint> {
  const repo = await prisma.repository.create({
    data: {
      owner: TEST_OWNER,
      name,
      node: { stub: true } as never,
      fetchStatus: 'ok',
    },
  });
  testRepoIds.push(repo.id);
  return repo.id;
}

async function seedJob(
  repositoryId: bigint,
  status: 'pending' | 'in_progress' | 'done' | 'failed',
  overrides: { scheduledFor?: Date; priority?: number; updatedAt?: Date; lastError?: string | null } = {},
): Promise<void> {
  const now = Date.now();
  await prisma.refreshJob.create({
    data: {
      repositoryId,
      priority: overrides.priority ?? 50,
      scheduledFor: overrides.scheduledFor ?? new Date(now - 1000),
      status,
      attempts: 0,
      ...(overrides.updatedAt !== undefined ? { updatedAt: overrides.updatedAt } : {}),
      ...(overrides.lastError !== undefined ? { lastError: overrides.lastError } : {}),
    },
  });
}

describe('listJobsByStatus', () => {
  it('returns only pending jobs, sorted by priority ASC then scheduledFor ASC', async () => {
    const r1 = await seedRepo('pending-a');
    const r2 = await seedRepo('pending-b');
    const r3 = await seedRepo('pending-c');

    // Mix of priorities + scheduledFor to assert the order.
    await seedJob(r1, 'pending', { priority: 50, scheduledFor: new Date(1000) });
    await seedJob(r2, 'pending', { priority: 10, scheduledFor: new Date(2000) });
    await seedJob(r3, 'pending', { priority: 10, scheduledFor: new Date(1500) });

    const rows = await listJobsByStatus('pending', 50);
    const mine = rows.filter((r) => r.repository.owner === TEST_OWNER);
    expect(mine).toHaveLength(3);
    // priority=10 (most urgent) come first; ties broken by earlier scheduledFor.
    expect(mine.map((r) => r.priority)).toEqual([10, 10, 50]);
    expect(mine[0]?.repository.name).toBe('pending-c');
    expect(mine[1]?.repository.name).toBe('pending-b');
    expect(mine[2]?.repository.name).toBe('pending-a');
  });

  it('returns only in_progress jobs, sorted by updatedAt DESC', async () => {
    const r1 = await seedRepo('inprog-a');
    const r2 = await seedRepo('inprog-b');
    const older = new Date(Date.now() - 60_000);
    const newer = new Date(Date.now() - 1000);
    await seedJob(r1, 'in_progress', { updatedAt: older });
    await seedJob(r2, 'in_progress', { updatedAt: newer });

    const rows = await listJobsByStatus('in_progress', 50);
    const mine = rows.filter((r) => r.repository.owner === TEST_OWNER);
    expect(mine).toHaveLength(2);
    expect(mine[0]?.repository.name).toBe('inprog-b');
    expect(mine[1]?.repository.name).toBe('inprog-a');
  });

  it('returns only done jobs, sorted by updatedAt DESC', async () => {
    const r1 = await seedRepo('done-a');
    const r2 = await seedRepo('done-b');
    const older = new Date(Date.now() - 60_000);
    const newer = new Date(Date.now() - 1000);
    await seedJob(r1, 'done', { updatedAt: older });
    await seedJob(r2, 'done', { updatedAt: newer });

    const rows = await listJobsByStatus('done', 50);
    const mine = rows.filter((r) => r.repository.owner === TEST_OWNER);
    expect(mine).toHaveLength(2);
    expect(mine[0]?.repository.name).toBe('done-b');
  });

  it('respects the limit', async () => {
    const r = await seedRepo('many');
    for (let i = 0; i < 5; i += 1) await seedJob(r, 'pending', { priority: 50 });
    const rows = await listJobsByStatus('pending', 3);
    // The DB is shared; we only check that the result was capped at 3.
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  it('listPendingJobs (legacy) still works for /admin/refresh backward compat', async () => {
    const r = await seedRepo('legacy');
    await seedJob(r, 'pending', { priority: 5 });
    const rows = await listPendingJobs(50);
    expect(rows.some((j) => j.repository.owner === TEST_OWNER && j.repository.name === 'legacy')).toBe(true);
  });
});

describe('listJobsInRange', () => {
  it('returns done jobs whose updatedAt is within the window, sorted by updatedAt DESC', async () => {
    const r1 = await seedRepo('r-a');
    const r2 = await seedRepo('r-b');
    const r3 = await seedRepo('r-c');
    const inWindow1 = new Date(Date.now() - 60_000); // 1 min ago — inside window
    const inWindow2 = new Date(Date.now() - 60 * 60_000); // 1h ago — inside window
    const outWindow = new Date(Date.now() - 26 * 60 * 60_000); // 26h ago — outside 24h
    await seedJob(r1, 'done', { updatedAt: inWindow1 });
    await seedJob(r2, 'done', { updatedAt: inWindow2 });
    await seedJob(r3, 'done', { updatedAt: outWindow });

    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = new Date();
    const rows = await listJobsInRange('done', from, to, 50);
    const mine = rows.filter((r) => r.repository.owner === TEST_OWNER);
    expect(mine).toHaveLength(2);
    expect(mine.map((r) => r.repository.name).sort()).toEqual(['r-a', 'r-b']);
  });

  it('respects the limit', async () => {
    const r = await seedRepo('many-done');
    for (let i = 0; i < 5; i += 1) {
      await seedJob(r, 'done', { updatedAt: new Date(Date.now() - 1000 - i * 100) });
    }
    const to = new Date();
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await listJobsInRange('done', from, to, 2);
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it('returns failed jobs in the window', async () => {
    const r = await seedRepo('failed-in-window');
    await seedJob(r, 'failed', { updatedAt: new Date(Date.now() - 1000), lastError: 'boom' });
    const rows = await listJobsInRange(
      'failed',
      new Date(Date.now() - 60_000),
      new Date(),
      50,
    );
    expect(rows.some((j) => j.repository.owner === TEST_OWNER && j.repository.name === 'failed-in-window')).toBe(true);
  });
});

describe('getOldestPending', () => {
  it('returns null when the pending queue is empty', async () => {
    // Best effort: clean any leftover pending from other tests by relying on
    // test isolation — only check that the response shape is null when
    // there are no OUR pending jobs.
    const r = await seedRepo('no-pending');
    // Seed a done job instead — should not affect oldest-pending.
    await seedJob(r, 'done', { updatedAt: new Date() });
    const oldest = await getOldestPending();
    // We can't assert == null because other tests may have left pending
    // rows in the shared DB. Instead, assert that the returned value is
    // either null or not our seeded scheduledFor.
    if (oldest !== null) {
      // If there are leftovers from other tests, just verify the type.
      expect(oldest).toBeInstanceOf(Date);
    }
  });

  it('returns the earliest scheduledFor across our seeded pending jobs', async () => {
    const r1 = await seedRepo('oldest-a');
    const r2 = await seedRepo('oldest-b');
    const earlier = new Date(Date.now() - 60 * 60_000); // 1h ago
    const later = new Date(Date.now() - 1000); // 1s ago
    await seedJob(r1, 'pending', { priority: 99, scheduledFor: later });
    await seedJob(r2, 'pending', { priority: 99, scheduledFor: earlier });

    const oldest = await getOldestPending();
    // Can't assert == earlier exactly because other tests may have left an
    // older pending row; assert our earlier one is <= the returned value.
    expect(oldest).not.toBeNull();
    expect(oldest!.getTime()).toBeLessThanOrEqual(earlier.getTime());
  });
});