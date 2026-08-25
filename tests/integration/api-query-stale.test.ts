import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { Octokit } from '@octokit/rest';
import { POST } from '@/app/api/query/route';
import { prisma } from '@/lib/db/client';
import { generateApiKey } from '@/lib/api-keys/generate';
import { GitHubUnavailable, GitHubError, NotFoundError } from '@/lib/errors';

// Mock the token pool — these tests don't care about token rotation.
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
  opts: { lastFetchedAt?: Date; fetchStatus?: 'ok' | 'error' | 'not_found' | 'forbidden'; metadata?: unknown } = {},
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

  it('GitHubUnavailable with no cache returns fetch_status:error', async () => {
    // Mock fetchRepoCore to simulate network failure.
    const client = await import('@/lib/github/client');
    vi.spyOn(client, 'fetchRepoCore').mockImplementationOnce(async () => {
      throw new GitHubUnavailable('connection refused');
    });

    const res = await postQuery([`${TEST_REPO_OWNER_PREFIX}nomiss/r`]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ fetch_status: string; stale?: boolean; error?: string }>;
    };
    expect(body.results[0]!.fetch_status).toBe('error');
    expect(body.results[0]!.stale).toBeUndefined();
    expect(body.results[0]!.error).toBeTruthy();
  });

  it('GitHubUnavailable WITH stale cache returns stale:true + warning (no warning field absent)', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60_000);
    await seedRow(`${TEST_REPO_OWNER_PREFIX}staleup`, { lastFetchedAt: old });

    // Mock fetchRepoCore to throw GitHubUnavailable.
    const client = await import('@/lib/github/client');
    vi.spyOn(client, 'fetchRepoCore').mockImplementationOnce(async () => {
      throw new GitHubUnavailable('connection refused');
    });

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
  });

  it('mixed batch: fresh cache + no-cache GitHubUnavailable → first fresh, second error', async () => {
    await seedRow(`${TEST_REPO_OWNER_PREFIX}freshmix`, { lastFetchedAt: new Date() });
    const client = await import('@/lib/github/client');
    vi.spyOn(client, 'fetchRepoCore').mockImplementationOnce(async () => {
      throw new GitHubUnavailable('connection refused');
    });

    const res = await postQuery([
      `${TEST_REPO_OWNER_PREFIX}freshmix/r`,
      `${TEST_REPO_OWNER_PREFIX}nomissmix/r`,
    ]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ fetch_status: string; stale: boolean; warning?: string }>;
    };
    expect(body.results).toHaveLength(2);
    expect(body.results[0]!.fetch_status).toBe('ok');
    expect(body.results[0]!.stale).toBe(false);
    expect(body.results[1]!.fetch_status).toBe('error');
    expect(body.results[1]!.stale).toBeUndefined();
  });

  it('mixed batch: both stale + second GitHubUnavailable → both stale:true', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60_000);
    await seedRow(`${TEST_REPO_OWNER_PREFIX}s1`, { lastFetchedAt: old });
    await seedRow(`${TEST_REPO_OWNER_PREFIX}s2`, { lastFetchedAt: old });

    const client = await import('@/lib/github/client');
    vi.spyOn(client, 'fetchRepoCore').mockImplementationOnce(async () => {
      throw new GitHubUnavailable('connection refused');
    });

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
    // First row: stale cache hit (no upstream call needed) → stale:true
    expect(body.results[0]!.fetch_status).toBe('ok');
    expect(body.results[0]!.stale).toBe(true);
    expect(body.results[0]!.warning).toBe('data may be delayed');
    // Second row: stale cache + upstream failed → also stale:true
    expect(body.results[1]!.fetch_status).toBe('ok');
    expect(body.results[1]!.stale).toBe(true);
    expect(body.results[1]!.warning).toBe('data may be delayed');
  });

  it('NotFoundError does NOT trigger stale path', async () => {
    const client = await import('@/lib/github/client');
    vi.spyOn(client, 'fetchRepoCore').mockImplementationOnce(async () => {
      throw new NotFoundError('Repo x/y not found');
    });

    const res = await postQuery([`${TEST_REPO_OWNER_PREFIX}nf/r`]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ fetch_status: string; stale?: boolean }>;
    };
    expect(body.results[0]!.fetch_status).toBe('not_found');
    expect(body.results[0]!.stale).toBeUndefined();
  });

  it('GitHubError (5xx) does NOT trigger stale path', async () => {
    const client = await import('@/lib/github/client');
    vi.spyOn(client, 'fetchRepoCore').mockImplementationOnce(async () => {
      throw new GitHubError('GH_5XX', 503, 'upstream down');
    });

    const res = await postQuery([`${TEST_REPO_OWNER_PREFIX}err/r`]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ fetch_status: string; stale?: boolean }>;
    };
    expect(body.results[0]!.fetch_status).toBe('error');
    expect(body.results[0]!.stale).toBeUndefined();
  });
});