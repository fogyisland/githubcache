import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { Octokit } from '@octokit/rest';
import { POST } from '@/app/api/query/route';
import { prisma } from '@/lib/db/client';
import { generateApiKey } from '@/lib/api-keys/generate';

// Mock the token pool — these tests don't care about token rotation.
// (Mocks kept around in case future scheduler-path tests need it.)
vi.mock('@/lib/github/pool', () => {
  const entry = { id: BigInt(1), octokit: new Octokit({ auth: 'ghp_test' }) };
  return {
    initPool: vi.fn(() => Promise.resolve()),
    pickToken: vi.fn(() => entry),
    recordUsage: vi.fn(() => Promise.resolve()),
    getBackoff: vi.fn(() => 10),
    shutdownPool: vi.fn(() => Promise.resolve()),
    poolSize: vi.fn(() => 1),
  };
});

const server = setupServer();

const TEST_REPO_OWNER_PREFIX = 'stale-test-';
const AUTH_EMAIL_PREFIX = 'stale-auth-';

let authPlainKey = '';

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  const user = await prisma.user.create({
    data: { email: `${AUTH_EMAIL_PREFIX}${Date.now()}@test`, role: 'admin', status: 'active' },
  });
  const generated = generateApiKey();
  authPlainKey = generated.plain;
  await prisma.apiKey.create({
    data: {
      userId: user.id,
      name: 'stale-test-key',
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
      status: 'active',
    },
  });
});

afterAll(async () => {
  server.close();
  // Cleanup test rows.
  await prisma.refreshJob.deleteMany({
    where: { repository: { owner: { startsWith: TEST_REPO_OWNER_PREFIX } } },
  });
  await prisma.repository.deleteMany({
    where: { owner: { startsWith: TEST_REPO_OWNER_PREFIX } },
  });
  await prisma.requestLog.deleteMany({});
  // Cleanup auth users + their keys.
  const authUsers = await prisma.user.findMany({
    where: { email: { startsWith: AUTH_EMAIL_PREFIX } },
    select: { id: true },
  });
  if (authUsers.length > 0) {
    await prisma.apiKey.deleteMany({ where: { userId: { in: authUsers.map((u) => u.id) } } });
    await prisma.auditLog.deleteMany({
      where: { actorUserId: { in: authUsers.map((u) => u.id) } },
    });
    await prisma.user.deleteMany({ where: { id: { in: authUsers.map((u) => u.id) } } });
  }
  await prisma.$disconnect();
});

beforeEach(async () => {
  server.resetHandlers();
  // Delete refreshJobs first (FK on repositoryId) then repositories.
  await prisma.refreshJob.deleteMany({
    where: { repository: { owner: { startsWith: TEST_REPO_OWNER_PREFIX } } },
  });
  await prisma.repository.deleteMany({
    where: { owner: { startsWith: TEST_REPO_OWNER_PREFIX } },
  });
});

async function postQuery(nodes: unknown[]): Promise<Response> {
  return POST(
    new Request('http://x/api/query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': authPlainKey,
      },
      body: JSON.stringify({ nodes }),
    }),
  );
}

async function seedRow(
  owner: string,
  opts: {
    lastFetchedAt?: Date;
    fetchStatus?: 'ok' | 'error' | 'not_found' | 'forbidden';
    metadata?: unknown;
  } = {},
): Promise<void> {
  await prisma.repository.create({
    data: {
      owner,
      name: 'r',
      node: `${owner}/r`,
      metadata: opts.metadata === undefined ? { stars: 100 } : (opts.metadata as object),
      fetchStatus: opts.fetchStatus ?? 'ok',
      lastFetchedAt: opts.lastFetchedAt ?? new Date(),
    },
  });
}

describe('POST /api/query — stale path', () => {
  it('fresh cache hit returns stale:false with no warning', async () => {
    await seedRow(`${TEST_REPO_OWNER_PREFIX}fresh`, { lastFetchedAt: new Date() });
    const res = await postQuery([`${TEST_REPO_OWNER_PREFIX}fresh/r`]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{
        fetch_status: string;
        stale: boolean;
        warning?: string;
      }>;
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.fetch_status).toBe('ok');
    expect(body.results[0]!.stale).toBe(false);
    expect(body.results[0]!.warning).toBeUndefined();
  });

  it('stale cache hit (>24h old) returns stale:true with warning', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60_000); // 25h ago
    await seedRow(`${TEST_REPO_OWNER_PREFIX}old`, { lastFetchedAt: old });
    const res = await postQuery([`${TEST_REPO_OWNER_PREFIX}old/r`]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{
        fetch_status: string;
        stale: boolean;
        warning?: string;
        last_fetched_at: string;
      }>;
    };
    expect(body.results[0]!.fetch_status).toBe('ok');
    expect(body.results[0]!.stale).toBe(true);
    expect(body.results[0]!.warning).toBe('data may be delayed');
    expect(new Date(body.results[0]!.last_fetched_at).getTime()).toBe(old.getTime());
  });

  it('cache miss returns fetch_status:pending (M20 queue-on-miss, no upstream call)', async () => {
    // M20: cache miss → enqueueRefresh → returns 'pending'. fetchRepoCore is
    // no longer called from /api/query at all. If MSW had a handler it would
    // log an unhandled-request error (server.listen uses onUnhandledRequest:
    // 'error'), so the absence of a handler below is itself part of the
    // assertion.
    const res = await postQuery([`${TEST_REPO_OWNER_PREFIX}nomiss/r`]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{
        fetch_status: string;
        queuedAt?: string;
        scheduledFor?: string;
      }>;
      summary: { pending: number };
    };
    expect(body.results[0]!.fetch_status).toBe('pending');
    expect(body.results[0]!.queuedAt).toBeTruthy();
    expect(body.results[0]!.scheduledFor).toBeTruthy();
    expect(body.summary.pending).toBe(1);
    // Stub repository + pending refreshJob should have been written.
    const repo = await prisma.repository.findUnique({
      where: { owner_name: { owner: `${TEST_REPO_OWNER_PREFIX}nomiss`, name: 'r' } },
    });
    expect(repo).not.toBeNull();
    const jobs = await prisma.refreshJob.findMany({
      where: { repositoryId: repo!.id, status: 'pending' },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.priority).toBe(70);
  });

  it('stale cache hit is returned without triggering upstream call (M20 no firstMiss)', async () => {
    // M20: a stale 'ok' row short-circuits the request path — we return the
    // existing metadata with stale:true instead of fetching. The previous
    // behaviour tried to refresh and fell back to stale on GitHubUnavailable;
    // that branch no longer exists.
    const old = new Date(Date.now() - 25 * 60 * 60_000);
    await seedRow(`${TEST_REPO_OWNER_PREFIX}staleup`, { lastFetchedAt: old });

    const res = await postQuery([`${TEST_REPO_OWNER_PREFIX}staleup/r`]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{
        fetch_status: string;
        stale: boolean;
        warning?: string;
        last_fetched_at: string;
      }>;
    };
    expect(body.results[0]!.fetch_status).toBe('ok');
    expect(body.results[0]!.stale).toBe(true);
    expect(body.results[0]!.warning).toBe('data may be delayed');
    expect(new Date(body.results[0]!.last_fetched_at).getTime()).toBe(old.getTime());
    // No refresh job should have been created — the row's fetchStatus is
    // still 'ok', so M20 treats it as a cache hit. The scheduler will pick
    // it up on its next aging sweep if lastFetchedAt crosses the TTL.
    expect(
      await prisma.refreshJob.findFirst({
        where: { repository: { owner: `${TEST_REPO_OWNER_PREFIX}staleup` } },
      }),
    ).toBeNull();
  });

  it('existing fetchStatus:not_found row returns terminal not_found (no re-enqueue)', async () => {
    // M20: 'not_found' is a terminal state — we do NOT re-enqueue rows that
    // already failed with 404, since GitHub will give us the same answer.
    await seedRow(`${TEST_REPO_OWNER_PREFIX}nf`, {
      fetchStatus: 'not_found',
      lastFetchedAt: new Date(),
    });
    const res = await postQuery([`${TEST_REPO_OWNER_PREFIX}nf/r`]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ fetch_status: string; stale?: boolean }>;
    };
    expect(body.results[0]!.fetch_status).toBe('not_found');
    expect(body.results[0]!.stale).toBeUndefined();
    // No new refreshJob for terminal not_found rows.
    expect(
      await prisma.refreshJob.findFirst({
        where: { repository: { owner: `${TEST_REPO_OWNER_PREFIX}nf` } },
      }),
    ).toBeNull();
  });

  it('existing fetchStatus:error row is re-enqueued (returns pending)', async () => {
    // M20: previous 'error' state is retryable — scheduler should try again.
    await seedRow(`${TEST_REPO_OWNER_PREFIX}err`, {
      fetchStatus: 'error',
      lastFetchedAt: new Date(Date.now() - 60 * 60_000),
    });
    const res = await postQuery([`${TEST_REPO_OWNER_PREFIX}err/r`]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{
        fetch_status: string;
        queuedAt?: string;
      }>;
    };
    expect(body.results[0]!.fetch_status).toBe('pending');
    expect(body.results[0]!.queuedAt).toBeTruthy();
  });

  it('mixed batch: fresh cache + cache miss → ok + pending', async () => {
    await seedRow(`${TEST_REPO_OWNER_PREFIX}freshmix`, { lastFetchedAt: new Date() });
    const res = await postQuery([
      `${TEST_REPO_OWNER_PREFIX}freshmix/r`,
      `${TEST_REPO_OWNER_PREFIX}nomissmix/r`,
    ]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ fetch_status: string; stale: boolean; queuedAt?: string }>;
    };
    expect(body.results).toHaveLength(2);
    expect(body.results[0]!.fetch_status).toBe('ok');
    expect(body.results[0]!.stale).toBe(false);
    expect(body.results[1]!.fetch_status).toBe('pending');
    expect(body.results[1]!.queuedAt).toBeTruthy();
  });

  it('mixed batch: both stale → both stale:true with no upstream calls', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60_000);
    await seedRow(`${TEST_REPO_OWNER_PREFIX}s1`, { lastFetchedAt: old });
    await seedRow(`${TEST_REPO_OWNER_PREFIX}s2`, { lastFetchedAt: old });

    const res = await postQuery([
      `${TEST_REPO_OWNER_PREFIX}s1/r`,
      `${TEST_REPO_OWNER_PREFIX}s2/r`,
    ]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{
        fetch_status: string;
        stale: boolean;
        warning?: string;
      }>;
    };
    expect(body.results).toHaveLength(2);
    for (const r of body.results) {
      expect(r.fetch_status).toBe('ok');
      expect(r.stale).toBe(true);
      expect(r.warning).toBe('data may be delayed');
    }
  });

  it('summary.stale counts per-node stale:true results', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60_000);
    await seedRow(`${TEST_REPO_OWNER_PREFIX}sumA`, { lastFetchedAt: old });
    await seedRow(`${TEST_REPO_OWNER_PREFIX}sumB`, { lastFetchedAt: new Date() });
    const res = await postQuery([
      `${TEST_REPO_OWNER_PREFIX}sumA/r`,
      `${TEST_REPO_OWNER_PREFIX}sumB/r`,
    ]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { hit: number; pending: number; not_found: number; error: number; stale: number };
    };
    expect(body.summary.hit).toBe(2);
    expect(body.summary.stale).toBe(1);
    expect(body.summary.pending).toBe(0);
    expect(body.summary.not_found).toBe(0);
    expect(body.summary.error).toBe(0);
  });
});
