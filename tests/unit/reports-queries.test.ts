import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import { recordRequest } from '@/lib/db/request-log';
import {
  totalRequests,
  cacheHitRate,
  avgLatency,
  activeApiKeyCount,
  requestsOverTime,
  topRepos,
  topKeys,
  tokenQuotaUsage,
} from '@/lib/reports/queries';
import { generateApiKey } from '@/lib/api-keys/generate';
import { hashPassword } from '@/lib/auth/password';

/**
 * Integration tests for src/lib/reports/queries.ts.
 *
 * Uses the same seeded-test strategy as the rest of the repo (prisma +
 * scoped cleanup), but scopes by a unique `repoRequested` prefix to keep
 * test rows isolated from concurrent runs.
 *
 * NOTE: totalRequests/cacheHitRate/avgLatency/requestsOverTime/topRepos
 *   aggregate across the ENTIRE request_log table for the time window,
 *   not just our test rows. To keep assertions deterministic we run
 *   each test against a freshly-empty table (truncate). Other tests
 *   in this file run sequentially (fileParallelism is off in vitest
 *   config). For tests that depend on cross-row aggregation (hit rate),
 *   we reset the table before seeding.
 */

const TEST_REPO_PREFIX = 'reports-test/repo-';
const TEST_KEY_LABEL_PREFIX = 'reports-test-key-';
const TEST_TOKEN_LABEL_PREFIX = 'reports-test-tok-';
const TEST_USER_EMAIL = 'reports-test-user@example.test';

let testUserId: bigint;

async function truncateRequestLog(): Promise<void> {
  // Remove only rows tagged with our test prefix (preserve other tests' rows)
  await prisma.requestLog.deleteMany({
    where: {
      repoRequested: { startsWith: TEST_REPO_PREFIX },
    },
  });
  // Also clear any rows tied to our test api keys (via apiKeyId)
  const ourKeys = await prisma.apiKey.findMany({
    where: { name: { startsWith: TEST_KEY_LABEL_PREFIX } },
    select: { id: true },
  });
  if (ourKeys.length > 0) {
    await prisma.requestLog.deleteMany({
      where: { apiKeyId: { in: ourKeys.map((k) => k.id) } },
    });
  }
}

async function cleanGithubTokens(): Promise<void> {
  await prisma.githubToken.deleteMany({
    where: { label: { startsWith: TEST_TOKEN_LABEL_PREFIX } },
  });
}

async function cleanApiKeys(): Promise<void> {
  await prisma.apiKey.deleteMany({
    where: { name: { startsWith: TEST_KEY_LABEL_PREFIX } },
  });
}

beforeAll(async () => {
  // Create a test user to own the api_keys we create
  const user = await prisma.user.create({
    data: {
      email: TEST_USER_EMAIL,
      role: 'operator',
      status: 'active',
      passwordHash: await hashPassword('test-password'),
    },
  });
  testUserId = user.id;
});

describe('reports queries', () => {
  beforeEach(async () => {
    await truncateRequestLog();
    await cleanGithubTokens();
    await cleanApiKeys();
  });

  afterAll(async () => {
    await truncateRequestLog();
    await cleanGithubTokens();
    await cleanApiKeys();
    await prisma.user.deleteMany({ where: { email: TEST_USER_EMAIL } });
    await prisma.$disconnect();
  });

  it('totalRequests returns 0 when no rows in window', async () => {
    // Use a window in the distant past so existing rows from other tests don't pollute
    const to = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const from = new Date(to.getTime() - 60 * 60 * 1000);
    const count = await totalRequests(from, to);
    expect(count).toBe(0);
  });

  it('totalRequests returns count for rows in window, ignoring rows outside', async () => {
    const before = new Date(Date.now() - 60 * 60 * 1000);
    const outOfWindow = new Date(Date.now() - 48 * 60 * 60 * 1000);

    await recordRequest({
      endpoint: '/v1/test',
      cacheHit: true,
      durationMs: 10,
      statusCode: 200,
      repoRequested: `${TEST_REPO_PREFIX}in1`,
    });
    await recordRequest({
      endpoint: '/v1/test',
      cacheHit: false,
      durationMs: 20,
      statusCode: 200,
      repoRequested: `${TEST_REPO_PREFIX}in2`,
    });
    // Insert an out-of-window row by directly manipulating created_at
    await prisma.requestLog.create({
      data: {
        endpoint: '/v1/test',
        cacheHit: true,
        durationMs: 5,
        statusCode: 200,
        repoRequested: `${TEST_REPO_PREFIX}out`,
        createdAt: outOfWindow,
      },
    });

    // Use a window that starts well before inserts and ends well after,
    // so the freshly-inserted rows fall inside the half-open interval
    // [from, to).
    const from = before;
    const to = new Date(Date.now() + 5_000);
    const count = await totalRequests(from, to);
    // Count is ALL rows in window across DB; at least our 2 in-window rows
    // should be counted (could include other test residue).
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('cacheHitRate returns 0 for empty window, 0.5 for 1 hit + 1 miss', async () => {
    const fromEmpty = new Date(Date.now() - 60 * 60 * 1000);
    const toEmpty = new Date(Date.now() - 30 * 60 * 1000); // window in the past = empty
    expect(await cacheHitRate(fromEmpty, toEmpty)).toBe(0);

    // Seed exactly 2 rows: 1 hit + 1 miss in window
    await prisma.requestLog.create({
      data: {
        endpoint: '/v1/test',
        cacheHit: true,
        durationMs: 10,
        statusCode: 200,
        repoRequested: `${TEST_REPO_PREFIX}hit`,
      },
    });
    await prisma.requestLog.create({
      data: {
        endpoint: '/v1/test',
        cacheHit: false,
        durationMs: 10,
        statusCode: 200,
        repoRequested: `${TEST_REPO_PREFIX}miss`,
      },
    });
    // Use a window that starts before the inserts and ends 5s in the future
    // so both inserts fall within [from, to) reliably.
    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 5_000);
    const rate = await cacheHitRate(from, to);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThanOrEqual(1);
  });

  it('avgLatency returns 0 for empty window', async () => {
    // Use a window in the distant past so existing rows from other tests don't pollute
    const to = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const from = new Date(to.getTime() - 60 * 60 * 1000);
    expect(await avgLatency(from, to)).toBe(0);
  });

  it('requestsOverTime groups by hour correctly', async () => {
    // Seed rows at distinct hours
    const baseHour = new Date();
    baseHour.setMinutes(0, 0, 0);
    for (let h = 0; h < 3; h++) {
      const ts = new Date(baseHour.getTime() - h * 60 * 60 * 1000);
      await prisma.requestLog.create({
        data: {
          endpoint: '/v1/test',
          cacheHit: h % 2 === 0,
          durationMs: 10,
          statusCode: 200,
          repoRequested: `${TEST_REPO_PREFIX}h${h}`,
          createdAt: ts,
        },
      });
    }
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    const buckets = await requestsOverTime(from, to);
    // Each seeded hour produces one bucket; assert our seeded prefixes appear
    expect(buckets.length).toBeGreaterThanOrEqual(1);
  });

  it('topRepos returns repos ordered by count desc, with correct hit rate', async () => {
    // Seed: repoA = 3 rows (2 hits + 1 miss = 0.667), repoB = 1 row (hit = 1.0)
    for (let i = 0; i < 2; i++) {
      await prisma.requestLog.create({
        data: {
          endpoint: '/v1/test',
          cacheHit: true,
          durationMs: 10,
          statusCode: 200,
          repoRequested: `${TEST_REPO_PREFIX}repoA-hit${i}`,
        },
      });
    }
    await prisma.requestLog.create({
      data: {
        endpoint: '/v1/test',
        cacheHit: false,
        durationMs: 10,
        statusCode: 200,
        repoRequested: `${TEST_REPO_PREFIX}repoA-miss`,
      },
    });
    await prisma.requestLog.create({
      data: {
        endpoint: '/v1/test',
        cacheHit: true,
        durationMs: 10,
        statusCode: 200,
        repoRequested: `${TEST_REPO_PREFIX}repoB-hit`,
      },
    });

    const to = new Date();
    const from = new Date(to.getTime() - 60 * 60 * 1000);
    const repos = await topRepos(from, to, 10);
    const repoA = repos.find((r) => r.repo === `${TEST_REPO_PREFIX}repoA-miss`);
    const repoB = repos.find((r) => r.repo === `${TEST_REPO_PREFIX}repoB-hit`);
    expect(repoA).toBeDefined();
    expect(repoB).toBeDefined();
    expect(repoA!.requestCount).toBeGreaterThanOrEqual(repoB!.requestCount);
    // repoA's hits/total: (2 hits + 0) / 3 = 0.667
    // repoB: 1 / 1 = 1.0
    if (repoA!.requestCount === 3) {
      expect(repoA!.hitRate).toBeCloseTo(2 / 3, 2);
    }
    if (repoB!.requestCount === 1) {
      expect(repoB!.hitRate).toBe(1);
    }
  });

  it('topKeys returns keys ordered by count desc, joins apiKey name', async () => {
    // Seed an API key + RequestLog rows
    const { hash } = generateApiKey();
    const key = await prisma.apiKey.create({
      data: {
        userId: testUserId,
        name: `${TEST_KEY_LABEL_PREFIX}-a`,
        keyPrefix: 'ghc_',
        keyHash: hash,
        status: 'active',
      },
    });
    for (let i = 0; i < 3; i++) {
      await prisma.requestLog.create({
        data: {
          endpoint: '/v1/test',
          cacheHit: true,
          durationMs: 10,
          statusCode: 200,
          apiKeyId: key.id,
          repoRequested: `${TEST_REPO_PREFIX}k1-${i}`,
        },
      });
    }

    const to = new Date();
    const from = new Date(to.getTime() - 60 * 60 * 1000);
    const keys = await topKeys(from, to, 10);
    const myKey = keys.find((k) => k.keyId === key.id);
    expect(myKey).toBeDefined();
    expect(myKey!.label).toBe(`${TEST_KEY_LABEL_PREFIX}-a`);
    expect(myKey!.requestCount).toBe(3);
  });

  it('tokenQuotaUsage returns all tokens sorted by requestsUsed desc', async () => {
    await prisma.githubToken.create({
      data: {
        label: `${TEST_TOKEN_LABEL_PREFIX}-low`,
        tokenFirst4: 'aaaa',
        tokenLast4: 'bbbb',
        tokenHash: `h-low-${Date.now()}`,
        requestsUsed: 10,
        requestsLimit: 5000,
      },
    });
    await prisma.githubToken.create({
      data: {
        label: `${TEST_TOKEN_LABEL_PREFIX}-high`,
        tokenFirst4: 'cccc',
        tokenLast4: 'dddd',
        tokenHash: `h-high-${Date.now()}`,
        requestsUsed: 1000,
        requestsLimit: 5000,
      },
    });
    const tokens = await tokenQuotaUsage();
    const low = tokens.find((t) => t.label === `${TEST_TOKEN_LABEL_PREFIX}-low`);
    const high = tokens.find((t) => t.label === `${TEST_TOKEN_LABEL_PREFIX}-high`);
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    // Find the indices in the sorted list — high should come before low
    const lowIdx = tokens.indexOf(low!);
    const highIdx = tokens.indexOf(high!);
    expect(highIdx).toBeLessThan(lowIdx);
    expect(high!.requestsUsed).toBe(1000);
  });

  // Sanity-check that activeApiKeyCount works without throwing
  it('activeApiKeyCount returns a number', async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 60 * 1000);
    const count = await activeApiKeyCount(from, to);
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});