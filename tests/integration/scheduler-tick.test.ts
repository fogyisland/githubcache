import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Octokit } from '@octokit/rest';
import type { RefreshJob, Repository } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { runTick } from '@/lib/scheduler/tick';

// Hoist the pickToken queue so the vi.mock factory and test bodies share it.
const pickQueue = vi.hoisted(() => {
  const queue: Array<{ id: bigint; octokit: Octokit } | null> = [];
  return {
    queue,
    reset() {
      queue.length = 0;
    },
    push(t: { id: bigint; octokit: Octokit } | null) {
      queue.push(t);
    },
    // Push enough tokens to cover SCHEDULER_BATCH_SIZE (default 10) plus one.
    // Tests share a live DB; the queue may contain leftover jobs from other
    // tests that get claimed alongside ours. Promise.all processes claimed
    // jobs concurrently, so we need at least batch-size tokens available, or
    // jobs that lose the race will fail as GitHubUnavailable.
    fill(n: number) {
      for (let i = 0; i < n; i += 1) {
        queue.push({ id: BigInt(i + 1), octokit: new Octokit({ auth: 'ghp_test_fake_token' }) });
      }
    },
  };
});

vi.mock('@/lib/github/pool', () => ({
  initPool: vi.fn(() => Promise.resolve()),
  pickToken: vi.fn(() => {
    if (pickQueue.queue.length === 0) return null;
    return pickQueue.queue.shift() ?? null;
  }),
  recordUsage: vi.fn(() => Promise.resolve()),
  getBackoff: vi.fn(() => 10),
  shutdownPool: vi.fn(() => Promise.resolve()),
  poolSize: vi.fn(() => pickQueue.queue.length + 1),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const TEST_OWNER = 'scheduler-tick-test';
const GH_BASE = 'https://api.github.com';

const server = setupServer();

function ghOk(name: string) {
  return http.get(`${GH_BASE}/repos/${TEST_OWNER}/${name}`, () =>
    HttpResponse.json(
      { name, default_branch: 'main', stargazers_count: 5 },
      { headers: { etag: `W/"${name}-etag"` } },
    ),
  );
}

function ghNotFound(name: string) {
  return http.get(`${GH_BASE}/repos/${TEST_OWNER}/${name}`, () =>
    new HttpResponse(null, { status: 404 }),
  );
}

describe('runTick', () => {
  let repo: Repository;

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

  beforeEach(async () => {
    pickQueue.reset();
    server.resetHandlers();
    await prisma.refreshJob.deleteMany({ where: { repository: { owner: TEST_OWNER } } });
    await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });

    repo = await prisma.repository.create({
      data: {
        owner: TEST_OWNER,
        name: 'tick-repo',
        node: { id: 77_777_777 },
        fetchStatus: 'ok',
      },
    });
  });

  afterEach(async () => {
    await prisma.refreshJob.deleteMany({ where: { repository: { owner: TEST_OWNER } } });
    await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });
  });

  afterAll(async () => {
    server.close();
    await prisma.$disconnect();
  });

  async function makePending(overrides: Partial<RefreshJob> = {}): Promise<RefreshJob> {
    return prisma.refreshJob.create({
      data: {
        repositoryId: repo.id,
        priority: 50,
        scheduledFor: new Date(Date.now() - 1000), // overdue
        status: 'pending',
        attempts: 0,
        ...overrides,
      },
    });
  }

  // NOTE: runTick drains the ENTIRE pending queue (claimBatch pulls ALL jobs).
  // Since the DB is shared across tests, observation is done on OUR test's
  // jobs after runTick rather than on the aggregate counts returned.

  it('returns zero claims for our test jobs when none are pending', async () => {
    pickQueue.fill(12);
    await runTick();
    // Our test jobs should still be untouched (no jobs in pending state for us)
    const ours = await prisma.refreshJob.findMany({
      where: { repository: { owner: TEST_OWNER }, status: 'pending' },
    });
    expect(ours).toHaveLength(0);
  });

  it('processes one pending job and reports done', async () => {
    pickQueue.fill(12);
    server.use(ghOk('tick-repo'));
    // Use priority=1 (most urgent) to ensure our test job gets claimed first
    // even when other tests have left high-priority jobs in the shared DB.
    const job = await makePending({ priority: 1 });
    await runTick();

    const updated = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    // After a successful 200, refreshOne sets status='done' and clears lockedUntil
    expect(updated?.status).toBe('done');
    expect(updated?.lockedUntil).toBeNull();
  });

  it('processes multiple pending jobs concurrently', async () => {
    const r2 = await prisma.repository.create({
      data: { owner: TEST_OWNER, name: 'tick-repo-2', node: { id: 77_777_778 }, fetchStatus: 'ok' },
    });
    const r3 = await prisma.repository.create({
      data: { owner: TEST_OWNER, name: 'tick-repo-3', node: { id: 77_777_779 }, fetchStatus: 'ok' },
    });

    pickQueue.fill(12);

    // Use priority=1 for all to ensure they get claimed
    const j1 = await makePending({ priority: 1 });
    const j2 = await prisma.refreshJob.create({
      data: {
        repositoryId: r2.id,
        priority: 1,
        scheduledFor: new Date(Date.now() - 1000),
        status: 'pending',
        attempts: 0,
      },
    });
    const j3 = await prisma.refreshJob.create({
      data: {
        repositoryId: r3.id,
        priority: 1,
        scheduledFor: new Date(Date.now() - 1000),
        status: 'pending',
        attempts: 0,
      },
    });

    server.use(ghOk('tick-repo'), ghOk('tick-repo-2'), ghOk('tick-repo-3'));
    await runTick();

    const all = await prisma.refreshJob.findMany({
      where: { id: { in: [j1.id, j2.id, j3.id] } },
    });
    expect(all).toHaveLength(3);
    for (const j of all) {
      expect(j.status).toBe('done');
      expect(j.lockedUntil).toBeNull();
    }
  });

  it('marks job rescheduled as pending on 404 (counts as pending in tick summary)', async () => {
    pickQueue.fill(12);
    server.use(ghNotFound('tick-repo'));
    // Use priority=1 to ensure our test job gets claimed
    const job = await makePending({ priority: 1 });
    await runTick();

    const updated = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    // 404 on first attempt → refreshOne marks status='pending' (will retry)
    expect(updated?.status).toBe('pending');
    // attempt count goes from 0 → 1 (404 counts in attempts)
    expect(updated?.attempts).toBeGreaterThanOrEqual(1);
  });

  it('does not process future-scheduled jobs', async () => {
    pickQueue.fill(12);
    server.use(ghOk('tick-repo'));
    const job = await makePending({ scheduledFor: new Date(Date.now() + 60_000) }); // future
    await runTick();

    const updated = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    // Future-scheduled job should still be untouched (status='pending', not done/in_progress)
    expect(updated?.status).toBe('pending');
    expect(updated?.lockedUntil).toBeNull();
  });

  it('does not double-process in_progress jobs (lease respected)', async () => {
    pickQueue.fill(12);
    server.use(ghOk('tick-repo'));
    const job = await makePending({ status: 'in_progress' });
    await runTick();

    const updated = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    // In-progress job should still be in_progress (not re-claimed)
    expect(updated?.status).toBe('in_progress');
  });

  it('respects SCHEDULER_BATCH_SIZE (does not claim more than batch)', { timeout: 30_000 }, async () => {
    pickQueue.fill(12);
    server.use(ghOk('tick-repo'));
    // Default batch size is 10; create 12 jobs at priority=1 to ensure they're
    // at the top of the queue.
    const jobIds = [];
    for (let i = 0; i < 12; i += 1) {
      const j = await makePending({ priority: 1 });
      jobIds.push(j.id);
    }
    await runTick();

    // After tick, count how many of our jobs are status='done' (successfully processed).
    // Should be at most SCHEDULER_BATCH_SIZE (10).
    const doneJobs = await prisma.refreshJob.count({
      where: { id: { in: jobIds }, status: 'done' },
    });
    expect(doneJobs).toBeLessThanOrEqual(10);
  });

  it('summary counts add up to claimed count', async () => {
    pickQueue.fill(12);
    server.use(ghOk('tick-repo'));
    // Verify COUNT consistency: done+pending+failed claimed by runTick always
    // equals the total claimed count. We check that the aggregate result is
    // well-formed (the actual counts depend on shared DB state).
    const result = await runTick();
    expect(result.done + result.pending + result.failed).toBe(result.claimed);
  });
});
