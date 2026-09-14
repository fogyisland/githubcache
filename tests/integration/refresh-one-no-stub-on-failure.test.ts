import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Octokit } from '@octokit/rest';
import type { RefreshJob } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { refreshOne } from '@/lib/jobs/refresh-one';

/**
 * M31.x — refresh-one 404 / 410 paths immediately write a terminal
 * `repositories` row with `fetchStatus='not_found'`, so subsequent
 * GETs return 404 with a user-friendly error body instead of bouncing
 * through the 202 pending → re-poll loop. 403 stays terminal but
 * leaves repositories empty (admin must intervene).
 *
 * This test creates a claimed refresh_job whose `repositoryId` is null
 * (no backing repositories row), then runs refreshOne against a mock
 * GitHub endpoint that returns each failure code. After the run:
 *
 *   - 404 / 410 → repositories row written with fetchStatus='not_found';
 *     refresh_job marked status='done' (terminal, 24h reschedule).
 *   - 403 → repositories row stays empty; refresh_job status='failed';
 *     audit log carries repo_forbidden.
 */

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

const TEST_OWNER = 'refresh-one-no-stub-test';
const GH_BASE = 'https://api.github.com';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(async () => {
  pickQueue.reset();
  server.resetHandlers();
  await prisma.refreshJob.deleteMany({ where: { owner: TEST_OWNER } });
  await prisma.auditLog.deleteMany({
    where: { targetType: 'repository', targetId: { startsWith: TEST_OWNER } },
  });
  await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });
});

afterEach(async () => {
  await prisma.refreshJob.deleteMany({ where: { owner: TEST_OWNER } });
  await prisma.auditLog.deleteMany({
    where: { targetType: 'repository', targetId: { startsWith: TEST_OWNER } },
  });
  await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });
});

afterAll(async () => {
  server.close();
  await prisma.$disconnect();
});

/**
 * Build a claimed refresh_job whose repositoryId is null — the M31
 * queue-on-miss shape (no backing repositories row yet).
 */
async function claimOrphan(
  overrides: Partial<RefreshJob> = {},
): Promise<RefreshJob> {
  return prisma.refreshJob.create({
    data: {
      owner: TEST_OWNER,
      name: 'orphan',
      repositoryId: null,
      priority: 50,
      scheduledFor: new Date(),
      status: 'in_progress',
      attempts: 0,
      ...overrides,
    },
  });
}

function ghNotFound(name = 'orphan') {
  return http.get(`${GH_BASE}/repos/${TEST_OWNER}/${name}`, () =>
    new HttpResponse(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
  );
}

function ghGone(name = 'orphan') {
  return http.get(`${GH_BASE}/repos/${TEST_OWNER}/${name}`, () =>
    new HttpResponse(JSON.stringify({ message: 'Gone' }), { status: 410 }),
  );
}

function ghForbidden(name = 'orphan') {
  return http.get(`${GH_BASE}/repos/${TEST_OWNER}/${name}`, () =>
    new HttpResponse(JSON.stringify({ message: 'Forbidden' }), { status: 403 }),
  );
}

describe('refreshOne on 404 (M31.x — terminal not_found row)', () => {
  it('writes repositories row with fetchStatus=not_found; refresh_job status=done', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghNotFound());

    const job = await claimOrphan();
    const result = await refreshOne(job);

    // 404 is terminal on first occurrence — refreshOne returns 'done'.
    expect(result.status).toBe('done');

    // M31.x — repositories row IS written with fetchStatus='not_found'.
    // Subsequent GETs hit the lookupRepo cache and return 404 directly.
    const repo = await prisma.repository.findUnique({
      where: { owner_name: { owner: TEST_OWNER, name: 'orphan' } },
    });
    expect(repo).not.toBeNull();
    expect(repo?.fetchStatus).toBe('not_found');
    expect(repo?.fetchError?.toLowerCase()).toContain('not found');

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.attempts).toBe(1);
    expect(refreshed?.status).toBe('done');
    expect(refreshed?.lastError?.toLowerCase()).toContain('not found');
  });
});

describe('refreshOne on 410 (M31.x — terminal not_found row)', () => {
  it('writes repositories row with fetchStatus=not_found', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghGone());

    const job = await claimOrphan();
    const result = await refreshOne(job);

    expect(result.status).toBe('done');

    const repo = await prisma.repository.findUnique({
      where: { owner_name: { owner: TEST_OWNER, name: 'orphan' } },
    });
    expect(repo).not.toBeNull();
    expect(repo?.fetchStatus).toBe('not_found');

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.attempts).toBe(1);
    expect(refreshed?.status).toBe('done');
    // 410 falls into the same not-found branch as 404; lastError is
    // the GitHub response body. Either substring is acceptable.
    const msg = refreshed?.lastError?.toLowerCase() ?? '';
    expect(msg.includes('not found') || msg.includes('gone')).toBe(true);
  });
});

describe('refreshOne on 403 (M31 — no stub row, audit only)', () => {
  it('leaves repositories table empty; writes repo_forbidden audit; marks job failed', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghForbidden());

    const job = await claimOrphan();
    const result = await refreshOne(job);

    // 403 is terminal — no requeue.
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toContain('Forbidden');
    }

    // M31 — repositories table stays empty.
    const repoCount = await prisma.repository.count({
      where: { owner: TEST_OWNER, name: 'orphan' },
    });
    expect(repoCount).toBe(0);

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('failed');
    expect(refreshed?.lastError).toContain('Forbidden');
    // Terminal — no next attempt scheduled (scheduledFor in the past).
    expect(refreshed?.scheduledFor.getTime()).toBeLessThanOrEqual(Date.now());

    // Audit log: action=repo_forbidden, targetId=owner/name (NOT repoId),
    // metadata has status=403 + message.
    const audits = await prisma.auditLog.findMany({
      where: {
        action: 'repo_forbidden',
        targetType: 'repository',
        targetId: `${TEST_OWNER}/orphan`,
      },
    });
    expect(audits).toHaveLength(1);
    const metadata = audits[0]?.metadata as { status: number; message: string };
    expect(metadata.status).toBe(403);
    expect(metadata.message).toContain('Forbidden');
  });
});

describe('refreshOne on repeated 404s (M31.x — first occurrence is terminal)', () => {
  it('writes repo_not_found audit; refreshOne ignores prior attempts since first 404 already terminated', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(ghNotFound());

    // Pre-set attempts:4 — irrelevant now. First 404 always terminates
    // immediately in M31.x, regardless of attempts count. We assert that
    // the run is still 'done' and the audit carries the repo_not_found
    // action (not the legacy refresh.failed_review escalation).
    const job = await claimOrphan({ attempts: 4 });
    const result = await refreshOne(job);

    expect(result.status).toBe('done');

    // M31.x — repositories row IS written with fetchStatus='not_found'.
    const repo = await prisma.repository.findUnique({
      where: { owner_name: { owner: TEST_OWNER, name: 'orphan' } },
    });
    expect(repo).not.toBeNull();
    expect(repo?.fetchStatus).toBe('not_found');

    const refreshed = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('done');
    // attempts is job.attempts + 1 = 5 — recorded for diagnostics,
    // but the row is terminal regardless.
    expect(refreshed?.attempts).toBe(5);

    // Audit log: action=repo_not_found (the new M31.x terminal-write
    // action). targetId is owner/name. metadata carries attempts + message.
    const audits = await prisma.auditLog.findMany({
      where: {
        action: 'repo_not_found',
        targetType: 'repository',
        targetId: `${TEST_OWNER}/orphan`,
      },
    });
    expect(audits).toHaveLength(1);
    const metadata = audits[0]?.metadata as {
      attempts: number;
      message: string;
      kind: string;
    };
    expect(metadata.kind).toBe('not_found');
    expect(metadata.attempts).toBe(5);
  });
});
