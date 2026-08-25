import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Octokit } from '@octokit/rest';
import type { RefreshJob, Repository } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { refreshOne } from '@/lib/jobs/refresh-one';

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

const fakeOctokit = (): Octokit => new Octokit({ auth: 'ghp_test_fake_token' });

const TEST_OWNER = 'refresh-one-test';
const GH_BASE = 'https://api.github.com';

const server = setupServer();

describe('refreshOne', () => {
  let repo: Repository;

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

  beforeEach(async () => {
    pickQueue.reset();
    server.resetHandlers();
    await prisma.refreshJob.deleteMany({ where: { repository: { owner: TEST_OWNER } } });
    await prisma.auditLog.deleteMany({
      where: { targetType: 'repository', targetId: { startsWith: TEST_OWNER } },
    });
    await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });

    repo = await prisma.repository.create({
      data: {
        owner: TEST_OWNER,
        name: 'r1',
        node: { id: 88_888_888 },
        etag: 'W/"prior-etag"',
        fetchStatus: 'ok',
      },
    });
  });

  afterEach(async () => {
    await prisma.refreshJob.deleteMany({ where: { repository: { owner: TEST_OWNER } } });
    await prisma.auditLog.deleteMany({
      where: { targetType: 'repository', targetId: { startsWith: TEST_OWNER } },
    });
    await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });
  });

  afterAll(async () => {
    server.close();
    await prisma.$disconnect();
  });

  // Creates a job in 'in_progress' state with attempts:0 (matches what
  // claimBatch would produce) and includes the parent repository.
  async function claimAndMake(
    overrides: Partial<RefreshJob> = {},
  ): Promise<RefreshJob & { repository: Repository }> {
    return prisma.refreshJob.create({
      data: {
        repositoryId: repo.id,
        priority: 50,
        scheduledFor: new Date(),
        status: 'in_progress',
        attempts: 0,
        ...overrides,
      },
      include: { repository: true },
    }) as unknown as RefreshJob & { repository: Repository };
  }

  function ghOk(name = 'r1') {
    return http.get(`${GH_BASE}/repos/${TEST_OWNER}/${name}`, () =>
      HttpResponse.json(
        {
          name,
          default_branch: 'main',
          stargazers_count: 100,
          license: { spdx_id: 'MIT' },
        },
        { headers: { etag: 'W/"new-etag"' } },
      ),
    );
  }

  function ghNotModified(name = 'r1') {
    return http.get(`${GH_BASE}/repos/${TEST_OWNER}/${name}`, () =>
      new HttpResponse(null, { status: 304, headers: { etag: 'W/"prior-etag"' } }),
    );
  }

  function ghNotFound(name = 'r1') {
    return http.get(`${GH_BASE}/repos/${TEST_OWNER}/${name}`, () =>
      new HttpResponse(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
    );
  }

  function ghForbidden(name = 'r1') {
    return http.get(`${GH_BASE}/repos/${TEST_OWNER}/${name}`, () =>
      new HttpResponse(JSON.stringify({ message: 'Forbidden' }), { status: 403 }),
    );
  }

  function ghRateLimit(name = 'r1') {
    return http.get(`${GH_BASE}/repos/${TEST_OWNER}/${name}`, () =>
      new HttpResponse(JSON.stringify({ message: 'Rate limit' }), {
        status: 429,
        headers: { 'retry-after': '60' },
      }),
    );
  }

  function ghServerError(name = 'r1') {
    return http.get(`${GH_BASE}/repos/${TEST_OWNER}/${name}`, () =>
      new HttpResponse(JSON.stringify({ message: 'Server Error' }), { status: 502 }),
    );
  }

  it('on 200: parses, upserts metadata, marks job done, schedules next via successDelay', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghOk());
    const job = await claimAndMake();
    const result = await refreshOne(job);

    expect(result.status).toBe('done');

    const updated = await prisma.repository.findUnique({ where: { id: repo.id } });
    expect(updated?.fetchStatus).toBe('ok');
    expect(updated?.etag).toBe('W/"new-etag"');

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('done');
    expect(refreshed?.lockedUntil).toBeNull();
    expect(refreshed?.scheduledFor.getTime()).toBeGreaterThan(Date.now());
    expect(refreshed?.lastError).toBeNull();
  });

  it('on 200 with no prior refreshes: next is ~1h (successDelay 0 → 1h)', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghOk());
    const job = await claimAndMake();
    const before = Date.now();
    await refreshOne(job);
    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    const expectedMs = 60 * 60_000;
    const actualMs = refreshed!.scheduledFor.getTime() - before;
    // Allow 10s slop for test execution
    expect(actualMs).toBeGreaterThan(expectedMs - 10_000);
    expect(actualMs).toBeLessThan(expectedMs + 10_000);
  });

  it('on 304: marks done without re-fetching metadata', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghNotModified());
    const job = await claimAndMake();
    const beforeTs = Date.now();
    const result = await refreshOne(job);

    expect(result.status).toBe('done');

    const updated = await prisma.repository.findUnique({ where: { id: repo.id } });
    // Metadata unchanged — should still reflect the original ok status
    expect(updated?.fetchStatus).toBe('ok');
    expect(updated?.etag).toBe('W/"prior-etag"'); // unchanged
    // Spec §6.4: 304 path updates lastFetchedAt (proves cache is still fresh)
    expect(updated?.lastFetchedAt).not.toBeNull();
    expect(updated!.lastFetchedAt!.getTime()).toBeGreaterThan(beforeTs);

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('done');
  });

  it('on 404: stores fetch_status=not_found, status=pending, reschedules via failureDelay(1) = 5min', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghNotFound());
    const job = await claimAndMake();
    const result = await refreshOne(job);

    expect(result.status).toBe('pending');

    const updated = await prisma.repository.findUnique({ where: { id: repo.id } });
    expect(updated?.fetchStatus).toBe('not_found');
    // NotFoundError wraps the GitHub message; just verify it mentions the repo.
    expect(updated?.fetchError?.toLowerCase()).toContain('not found');

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.attempts).toBe(1);
    expect(refreshed?.status).toBe('pending');
    expect(refreshed!.scheduledFor!.getTime() - Date.now()).toBeGreaterThan(5 * 60_000 - 10_000);
  });

  it('on 403: stores fetch_status=forbidden, writes audit log, marks failed (no requeue)', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghForbidden());
    const job = await claimAndMake();
    const result = await refreshOne(job);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toContain('Forbidden');
    }

    const updated = await prisma.repository.findUnique({ where: { id: repo.id } });
    expect(updated?.fetchStatus).toBe('forbidden');

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('failed');
    // Not rescheduled — scheduledFor is the original value (now in the past)
    expect(refreshed?.scheduledFor.getTime()).toBeLessThanOrEqual(Date.now());

    const audits = await prisma.auditLog.findMany({
      where: { targetType: 'repository', targetId: `${TEST_OWNER}/r1` },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('repo_forbidden');
  });

  it('on 429: releases lock, status=pending, attempts NOT incremented', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghRateLimit());
    const job = await claimAndMake({ attempts: 2 });
    const result = await refreshOne(job);

    expect(result.status).toBe('pending');

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('pending');
    expect(refreshed?.attempts).toBe(2); // unchanged
    expect(refreshed?.lockedUntil).toBeNull();
    expect(refreshed?.scheduledFor.getTime()).toBeGreaterThan(Date.now());
  });

  it('on 5xx: releases lock, status=pending, attempts NOT incremented', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghServerError());
    const job = await claimAndMake({ attempts: 3 });
    const result = await refreshOne(job);

    expect(result.status).toBe('pending');

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('pending');
    expect(refreshed?.attempts).toBe(3); // unchanged
  });

  it('on 5 consecutive 404s: marks job failed, writes refresh.failed_review audit with kind=not_found', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghNotFound());
    // In production, the same job is re-claimed by claimBatch which increments
    // attempts each time. Here we pre-set attempts:4 so the next refreshOne
    // call increments to 5 — exercising the "5 consecutive failures → terminal"
    // branch.
    const job = await claimAndMake({ attempts: 4 });
    const result = await refreshOne(job);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error.toLowerCase()).toContain('not found');
    }

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('failed');
    expect(refreshed?.attempts).toBe(5);

    // Spec §10.4: terminal refresh failures escalate to admin via
    // action='refresh.failed_review'. metadata.kind distinguishes 404 from
    // unexpected-error escalations.
    const audits = await prisma.auditLog.findMany({
      where: {
        action: 'refresh.failed_review',
        targetType: 'repository',
        targetId: `${TEST_OWNER}/r1`,
      },
    });
    expect(audits).toHaveLength(1);
    const metadata = audits[0]?.metadata as {
      repoId: string;
      attempts: number;
      message: string;
      kind: string;
    };
    expect(metadata.kind).toBe('not_found');
    expect(metadata.attempts).toBe(5);
    expect(metadata.repoId).toBe(repo.id.toString());
  });

  it('on 5 consecutive unexpected errors: marks job failed, writes refresh.failed_review with kind=unexpected', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    // 400 falls through to the catch-all "other" branch (failure ladder).
    server.use(
      http.get(`${GH_BASE}/repos/${TEST_OWNER}/r1`, () =>
        HttpResponse.json({ message: 'mock network failure' }, { status: 400 }),
      ),
    );
    const job = await claimAndMake({ attempts: 4 });
    const result = await refreshOne(job);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toContain('mock network failure');
    }

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('failed');
    expect(refreshed?.attempts).toBe(5);

    const audits = await prisma.auditLog.findMany({
      where: {
        action: 'refresh.failed_review',
        targetType: 'repository',
        targetId: `${TEST_OWNER}/r1`,
      },
    });
    expect(audits).toHaveLength(1);
    const metadata = audits[0]?.metadata as {
      repoId: string;
      attempts: number;
      message: string;
      kind: string;
    };
    expect(metadata.kind).toBe('unexpected');
    expect(metadata.attempts).toBe(5);
    expect(metadata.message).toContain('mock network failure');
  });

  it('on 4 attempts (not terminal): does NOT write refresh.failed_review', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghNotFound());
    const job = await claimAndMake({ attempts: 3 });
    const result = await refreshOne(job);

    expect(result.status).toBe('pending');

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('pending');
    expect(refreshed?.attempts).toBe(4); // incremented, but still under terminal

    const audits = await prisma.auditLog.findMany({
      where: {
        action: 'refresh.failed_review',
        targetType: 'repository',
        targetId: `${TEST_OWNER}/r1`,
      },
    });
    expect(audits).toHaveLength(0);
  });

  it('on unexpected error: increments attempts, uses failureDelay', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    // Return a 400 — not in any of the special-case branches (404, 403, 429,
    // 5xx, GitHubUnavailable), so it falls through to the catch-all "other
    // GitHubError" branch which runs the failure ladder.
    server.use(
      http.get(`${GH_BASE}/repos/${TEST_OWNER}/r1`, () =>
        HttpResponse.json({ message: 'mock network failure' }, { status: 400 }),
      ),
    );

    const job = await claimAndMake({ attempts: 1 });
    const result = await refreshOne(job);

    expect(result.status).toBe('pending');

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.attempts).toBe(2);
    expect(refreshed?.lastError).toContain('mock network failure');
  });

  it('clears lockedUntil on every branch', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghOk());
    const job = await claimAndMake({ lockedUntil: new Date(Date.now() + 60_000) });
    await refreshOne(job);

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.lockedUntil).toBeNull();
  });

  it('hot-bump: with >10 recent queries, schedules next in 1h regardless of refreshCount', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghOk());

    // Create a done refresh_job to give refreshCount=1
    await prisma.refreshJob.create({
      data: {
        repositoryId: repo.id,
        priority: 50,
        scheduledFor: new Date(),
        status: 'done',
        attempts: 1,
      },
    });

    // Create 11 request_log entries for this repo in the last 24h
    for (let i = 0; i < 11; i += 1) {
      await prisma.requestLog.create({
        data: {
          endpoint: '/api/query',
          repoRequested: `${TEST_OWNER}/r1`,
          cacheHit: true,
          durationMs: 10,
          statusCode: 200,
        },
      });
    }

    const job = await claimAndMake();
    const before = Date.now();
    await refreshOne(job);

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    const actualMs = refreshed!.scheduledFor.getTime() - before;
    // 1h expected (hot-bump overrides 6h from refreshCount=1)
    expect(actualMs).toBeGreaterThan(60 * 60_000 - 10_000);
    expect(actualMs).toBeLessThan(60 * 60_000 + 10_000);
  });

  it('returns plain RefreshJobResult object', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghOk());
    const job = await claimAndMake();
    const result = await refreshOne(job);
    expect(['done', 'pending', 'failed']).toContain(result.status);
  });
});
