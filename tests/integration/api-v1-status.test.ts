import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { GET } from '@/app/api/v1/status/route';
import { prisma } from '@/lib/db/client';

const TEST_REPO_OWNER_PREFIX = 'api-v1-status-';
const TEST_TOKEN_HASH_PREFIX = 'api-v1-status-token-';

vi.mock('@/lib/github/pool', () => ({
  poolSize: vi.fn(() => 0),
}));

async function cleanup(): Promise<void> {
  await prisma.refreshJob.deleteMany({
    where: { repository: { owner: { startsWith: TEST_REPO_OWNER_PREFIX } } },
  });
  await prisma.repository.deleteMany({
    where: { owner: { startsWith: TEST_REPO_OWNER_PREFIX } },
  });
  await prisma.githubToken.deleteMany({
    where: { tokenHash: { startsWith: TEST_TOKEN_HASH_PREFIX } },
  });
}

describe('GET /api/v1/status — full endpoint', () => {
  beforeAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('1) returns 200 with full shape when healthy', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    // All top-level keys must exist with correct types.
    expect(body).toMatchObject({
      ok: true,
      db: 'up',
      tokens: expect.objectContaining({
        active: expect.any(Number),
        exhausted: expect.any(Number),
        total: expect.any(Number),
      }),
      queue: expect.objectContaining({
        pending: expect.any(Number),
        in_progress: expect.any(Number),
        done: expect.any(Number),
        failed: expect.any(Number),
      }),
      repositories: expect.objectContaining({
        total: expect.any(Number),
        ok: expect.any(Number),
        not_found: expect.any(Number),
        forbidden: expect.any(Number),
        error: expect.any(Number),
      }),
      version: expect.objectContaining({
        commit: expect.any(String),
        startedAt: expect.any(String),
        nodeVersion: expect.any(String),
      }),
      timestamp: expect.any(String),
    });

    // timestamp is ISO and parseable.
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    // startedAt is also ISO.
    expect(Number.isNaN(Date.parse(body.version.startedAt))).toBe(false);
  });

  it('2) no auth required — endpoint is reachable without cookies or headers', async () => {
    // The handler takes no arguments; this test exists to lock in the
    // "no auth required" contract from the brief. We just call it directly.
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('3) tokens.active reflects poolSize()', async () => {
    // Override poolSize for this test to return 5.
    const pool = await import('@/lib/github/pool');
    vi.mocked(pool.poolSize).mockReturnValueOnce(5);

    const res = await GET();
    const body = await res.json();
    expect(body.tokens.active).toBe(5);
  });

  it('4) tokens.total reflects DB count of active github_tokens', async () => {
    // Seed 3 active tokens.
    await prisma.githubToken.createMany({
      data: [
        {
          label: 't1',
          tokenFirst4: 'aaaa',
          tokenLast4: 'bbbb',
          tokenHash: `${TEST_TOKEN_HASH_PREFIX}a1`,
          status: 'active',
        },
        {
          label: 't2',
          tokenFirst4: 'cccc',
          tokenLast4: 'dddd',
          tokenHash: `${TEST_TOKEN_HASH_PREFIX}a2`,
          status: 'active',
        },
        {
          label: 't3',
          tokenFirst4: 'eeee',
          tokenLast4: 'ffff',
          tokenHash: `${TEST_TOKEN_HASH_PREFIX}a3`,
          status: 'active',
        },
      ],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.tokens.total).toBe(3);
    // poolSize is still 0 (no initPool in tests).
    expect(body.tokens.active).toBe(0);
    // None exhausted (default requestsUsed=0, requestsLimit=5000).
    expect(body.tokens.exhausted).toBe(0);
  });

  it('4b) tokens.exhausted counts rows where requestsUsed >= requestsLimit and resetAt is in the future', async () => {
    // Two tokens: one exhausted (used >= limit, reset in future), one not.
    const future = new Date(Date.now() + 60 * 60_000);
    await prisma.githubToken.create({
      data: {
        label: 'exhausted',
        tokenFirst4: '1111',
        tokenLast4: '2222',
        tokenHash: `${TEST_TOKEN_HASH_PREFIX}ex1`,
        status: 'active',
        requestsUsed: 5000,
        requestsLimit: 5000,
        resetAt: future,
      },
    });
    await prisma.githubToken.create({
      data: {
        label: 'fresh',
        tokenFirst4: '3333',
        tokenLast4: '4444',
        tokenHash: `${TEST_TOKEN_HASH_PREFIX}fr1`,
        status: 'active',
        requestsUsed: 100,
        requestsLimit: 5000,
        resetAt: future,
      },
    });
    // And one with resetAt in the past — not exhausted.
    await prisma.githubToken.create({
      data: {
        label: 'past-reset',
        tokenFirst4: '5555',
        tokenLast4: '6666',
        tokenHash: `${TEST_TOKEN_HASH_PREFIX}pr1`,
        status: 'active',
        requestsUsed: 5000,
        requestsLimit: 5000,
        resetAt: new Date(Date.now() - 60_000),
      },
    });

    const res = await GET();
    const body = await res.json();
    expect(body.tokens.total).toBe(3);
    expect(body.tokens.exhausted).toBe(1);
  });

  it('5) repositories counts match seeded rows', async () => {
    // Seed 2 ok, 1 not_found, 1 forbidden, 1 error.
    await prisma.repository.create({
      data: {
        owner: `${TEST_REPO_OWNER_PREFIX}r1`,
        name: 'r',
        node: { id: 1 },
        fetchStatus: 'ok',
      },
    });
    await prisma.repository.create({
      data: {
        owner: `${TEST_REPO_OWNER_PREFIX}r2`,
        name: 'r',
        node: { id: 2 },
        fetchStatus: 'ok',
      },
    });
    await prisma.repository.create({
      data: {
        owner: `${TEST_REPO_OWNER_PREFIX}r3`,
        name: 'r',
        node: { id: 3 },
        fetchStatus: 'not_found',
      },
    });
    await prisma.repository.create({
      data: {
        owner: `${TEST_REPO_OWNER_PREFIX}r4`,
        name: 'r',
        node: { id: 4 },
        fetchStatus: 'forbidden',
      },
    });
    await prisma.repository.create({
      data: {
        owner: `${TEST_REPO_OWNER_PREFIX}r5`,
        name: 'r',
        node: { id: 5 },
        fetchStatus: 'error',
      },
    });

    const res = await GET();
    const body = await res.json();
    // We can't assert exact counts since the DB is shared, but we can assert
    // these counts are at least what we seeded.
    expect(body.repositories.ok).toBeGreaterThanOrEqual(2);
    expect(body.repositories.not_found).toBeGreaterThanOrEqual(1);
    expect(body.repositories.forbidden).toBeGreaterThanOrEqual(1);
    expect(body.repositories.error).toBeGreaterThanOrEqual(1);
    expect(body.repositories.total).toBeGreaterThanOrEqual(5);
  });

  it('6) queue counts match seeded jobs', async () => {
    // Create a repo to anchor the jobs.
    const repo = await prisma.repository.create({
      data: {
        owner: `${TEST_REPO_OWNER_PREFIX}q-repo`,
        name: 'r',
        node: { id: 999 },
        fetchStatus: 'ok',
      },
    });
    // Seed: 2 pending, 1 in_progress, 1 done (fresh), 1 failed.
    await prisma.refreshJob.create({
      data: {
        repositoryId: repo.id,
        priority: 50,
        scheduledFor: new Date(),
        status: 'pending',
      },
    });
    await prisma.refreshJob.create({
      data: {
        repositoryId: repo.id,
        priority: 50,
        scheduledFor: new Date(),
        status: 'pending',
      },
    });
    await prisma.refreshJob.create({
      data: {
        repositoryId: repo.id,
        priority: 50,
        scheduledFor: new Date(),
        status: 'in_progress',
      },
    });
    await prisma.refreshJob.create({
      data: {
        repositoryId: repo.id,
        priority: 50,
        scheduledFor: new Date(),
        status: 'done',
      },
    });
    await prisma.refreshJob.create({
      data: {
        repositoryId: repo.id,
        priority: 50,
        scheduledFor: new Date(),
        status: 'failed',
      },
    });

    const res = await GET();
    const body = await res.json();
    expect(body.queue.pending).toBeGreaterThanOrEqual(2);
    expect(body.queue.in_progress).toBeGreaterThanOrEqual(1);
    expect(body.queue.done).toBeGreaterThanOrEqual(1); // done count is last-24h
    expect(body.queue.failed).toBeGreaterThanOrEqual(1);
  });

  it('7) version.commit reads from process.env.GIT_COMMIT', async () => {
    const original = process.env.GIT_COMMIT;
    process.env.GIT_COMMIT = 'abc123def456';
    try {
      const res = await GET();
      const body = await res.json();
      expect(body.version.commit).toBe('abc123def456');
    } finally {
      if (original === undefined) {
        delete process.env.GIT_COMMIT;
      } else {
        process.env.GIT_COMMIT = original;
      }
    }
  });

  it('7b) version.commit is "unknown" when GIT_COMMIT is unset', async () => {
    const original = process.env.GIT_COMMIT;
    delete process.env.GIT_COMMIT;
    try {
      const res = await GET();
      const body = await res.json();
      expect(body.version.commit).toBe('unknown');
    } finally {
      if (original !== undefined) process.env.GIT_COMMIT = original;
    }
  });

  it('7c) version.nodeVersion matches process.version', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.version.nodeVersion).toBe(process.version);
  });

  it('8) db down: returns 503 with ok:false and zero counts', async () => {
    // Spy on prisma.$queryRaw and make it throw.
    const spy = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('connection refused') as never);

    try {
      const res = await GET();
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.db).toBe('down');
      expect(body.tokens).toEqual({ active: 0, exhausted: 0, total: 0 });
      expect(body.queue).toEqual({
        pending: 0,
        in_progress: 0,
        done: 0,
        failed: 0,
      });
      expect(body.repositories).toEqual({
        total: 0,
        ok: 0,
        not_found: 0,
        forbidden: 0,
        error: 0,
      });
      // version and timestamp are still populated.
      expect(body.version.commit).toBeDefined();
      expect(body.version.startedAt).toBeDefined();
      expect(body.version.nodeVersion).toBe(process.version);
      expect(body.timestamp).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});

// Type assertion to keep PrismaClient imported (needed for vi.spyOn inference).
const _typeAssert: PrismaClient | undefined = undefined;
void _typeAssert;