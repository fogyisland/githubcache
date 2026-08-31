import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Octokit } from '@octokit/rest';
import { POST } from '@/app/api/query/route';
import { prisma } from '@/lib/db/client';
import { generateApiKey } from '@/lib/api-keys/generate';

// Mock the token pool — these tests don't care about token rotation.
// Provide a single always-available token so fetchRepoCore proceeds.
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

const server = setupServer(
  http.get('https://api.github.com/repos/:owner/:name', ({ params }) =>
    HttpResponse.json({
      name: params.name,
      stargazers_count: 100,
      default_branch: 'main',
    }),
  ),
);

const TEST_OWNERS = ['cache-owner', 'miss-owner', 'dedupe', 'auth-test-owner'];
const AUTH_EMAIL_PREFIX = 'auth-test-';

let authPlainKey = '';
let authKeyId = 0n;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  // Create a user and approved API key for tests
  const user = await prisma.user.create({
    data: { email: `${AUTH_EMAIL_PREFIX}${Date.now()}@test`, role: 'admin', status: 'active' },
  });
  const generated = generateApiKey();
  authPlainKey = generated.plain;
  const created = await prisma.apiKey.create({
    data: {
      userId: user.id,
      name: 'query-test-key',
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
      status: 'active',
    },
  });
  authKeyId = created.id;
});

afterAll(async () => {
  server.close();
  for (const owner of TEST_OWNERS) {
    await prisma.refreshJob.deleteMany({ where: { repository: { owner } } });
    await prisma.repository.deleteMany({ where: { owner } });
  }
  await prisma.refreshJob.deleteMany({});
  await prisma.requestLog.deleteMany({});
  // Delete ALL api keys owned by auth-test users (not just authKeyId — leftover
  // keys from previous test runs reference users we're about to delete).
  const authUsers = await prisma.user.findMany({
    where: { email: { startsWith: AUTH_EMAIL_PREFIX } },
    select: { id: true },
  });
  if (authUsers.length > 0) {
    await prisma.apiKey.deleteMany({
      where: { userId: { in: authUsers.map((u) => u.id) } },
    });
  }
  await prisma.auditLog.deleteMany({
    where: { actorUserId: { in: authUsers.map((u) => u.id) } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: AUTH_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  server.resetHandlers();
  for (const owner of TEST_OWNERS) {
    // Delete refreshJobs first (FK on repositoryId) then repositories.
    await prisma.refreshJob.deleteMany({ where: { repository: { owner } } });
    await prisma.repository.deleteMany({ where: { owner } });
  }
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

describe('POST /api/query', () => {
  it('cache hit returns existing row without upstream call', async () => {
    await prisma.repository.create({
      data: {
        owner: 'cache-owner',
        name: 'r',
        node: 'cache-owner/r',
        metadata: { cached: true },
        fetchStatus: 'ok',
      },
    });
    const res = await postQuery(['cache-owner/r']);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ found: boolean; metadata: unknown }>;
    };
    expect(body.results[0]!.found).toBe(true);
    expect(body.results[0]!.metadata).toEqual({ cached: true });
  });

  it('cache miss enqueues refresh_job (M20: queue-on-miss)', async () => {
    const res = await postQuery(['miss-owner/new']);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ fetch_status: string; queuedAt?: string }>;
      summary: { pending: number; hit: number };
    };
    expect(body.results[0]!.fetch_status).toBe('pending');
    expect(body.results[0]!.queuedAt).toBeTruthy();
    expect(body.summary.pending).toBe(1);
    expect(body.summary.hit).toBe(0);
    // Stub repository row should exist (upserted so refreshJob has FK target)
    const persisted = await prisma.repository.findUnique({
      where: { owner_name: { owner: 'miss-owner', name: 'new' } },
    });
    expect(persisted).not.toBeNull();
    // RefreshJob should be queued at priority 70
    const jobs = await prisma.refreshJob.findMany({
      where: { repositoryId: persisted!.id },
    });
    expect(jobs.length).toBe(1);
    expect(jobs[0]!.priority).toBe(70);
    expect(jobs[0]!.status).toBe('pending');
    // MSW upstream should NOT have been called (no firstMiss)
    // The handler at line 24 would have responded, but we can verify the
    // postQuery call did not trigger fetch by checking no fetch occurred.
    // The point: cache miss now enqueues; firstMiss is removed.
  });

  it('rejects > 50 nodes with 400', async () => {
    const res = await postQuery(new Array(51).fill('a/b'));
    expect(res.status).toBe(400);
  });

  it('rejects malformed body with 400', async () => {
    const res = await POST(
      new Request('http://x/api/query', {
        method: 'POST',
        headers: { 'x-api-key': authPlainKey },
        body: JSON.stringify({ nodes: 'not-an-array' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('concurrent first-miss requests for the same key enqueue one job (M20)', async () => {
    // M20: cache miss no longer triggers upstream fetch; concurrent requests
    // for the same owner/name should produce exactly one pending refreshJob
    // (the duplicate-job guard in enqueueRefresh skips second-tries).
    const responses = await Promise.all([
      postQuery(['dedupe/r']),
      postQuery(['dedupe/r']),
      postQuery(['dedupe/r']),
    ]);
    for (const r of responses) expect(r.status).toBe(200);
    const repo = await prisma.repository.findUnique({
      where: { owner_name: { owner: 'dedupe', name: 'r' } },
    });
    expect(repo).not.toBeNull();
    const jobs = await prisma.refreshJob.findMany({
      where: { repositoryId: repo!.id },
    });
    expect(jobs.length).toBe(1);
  });

  it('rejects missing X-API-Key with 401', async () => {
    const res = await POST(
      new Request('http://x/api/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodes: ['cache-owner/r'] }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects invalid X-API-Key with 403', async () => {
    const res = await POST(
      new Request('http://x/api/query', {
        method: 'POST',
        headers: { 'x-api-key': 'ghc_live_invalid_does_not_exist' },
        body: JSON.stringify({ nodes: ['cache-owner/r'] }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects revoked key with 403', async () => {
    // Temporarily revoke, then restore
    await prisma.apiKey.update({ where: { id: authKeyId }, data: { status: 'revoked' } });
    try {
      const res = await postQuery(['cache-owner/r']);
      expect(res.status).toBe(403);
    } finally {
      await prisma.apiKey.update({ where: { id: authKeyId }, data: { status: 'active' } });
    }
  });
});
