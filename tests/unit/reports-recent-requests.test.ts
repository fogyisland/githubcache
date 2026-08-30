import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import { recordRequest } from '@/lib/db/request-log';
import { recentRequests } from '@/lib/reports/queries';
import { generateApiKey } from '@/lib/api-keys/generate';
import { hashPassword } from '@/lib/auth/password';

/**
 * Integration tests for `recentRequests()` in src/lib/reports/queries.ts.
 *
 * The function joins RequestLog with ApiKey for label resolution, applies
 * an optional [from, to) window on `createdAt`, and supports pagination.
 *
 * Test strategy: truncate the rows tagged with our prefix before each
 * test. Other RequestLog rows may exist; the assertions filter to our
 * prefix when comparing exact counts. Total returns the full DB count
 * (matches the pagination semantics in /admin/queries).
 */

const TEST_REPO_PREFIX = 'recent-req-test/repo-';
const TEST_KEY_LABEL_PREFIX = 'recent-req-test-key-';
const TEST_USER_EMAIL = 'recent-req-test-user@example.test';

let testUserId: bigint;

async function truncateTagged(): Promise<void> {
  await prisma.requestLog.deleteMany({
    where: { repoRequested: { startsWith: TEST_REPO_PREFIX } },
  });
  const ourKeys = await prisma.apiKey.findMany({
    where: { name: { startsWith: TEST_KEY_LABEL_PREFIX } },
    select: { id: true },
  });
  if (ourKeys.length > 0) {
    await prisma.requestLog.deleteMany({
      where: { apiKeyId: { in: ourKeys.map((k) => k.id) } },
    });
  }
  await prisma.apiKey.deleteMany({
    where: { name: { startsWith: TEST_KEY_LABEL_PREFIX } },
  });
}

beforeAll(async () => {
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

afterAll(async () => {
  await truncateTagged();
  await prisma.user.deleteMany({ where: { email: TEST_USER_EMAIL } });
  await prisma.$disconnect();
});

describe('recentRequests', () => {
  beforeEach(async () => {
    await truncateTagged();
  });

  it('returns rows with anonymous apiKeyId when endpoint is /api/v1', async () => {
    await recordRequest({
      endpoint: '/api/v1/repos/[owner]/[name]',
      cacheHit: true,
      durationMs: 25,
      statusCode: 200,
      repoRequested: `${TEST_REPO_PREFIX}v1`,
    });
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 5_000);
    const { rows, total } = await recentRequests({ skip: 0, take: 50 }, { from, to });
    const mine = rows.filter((r) => r.repoRequested === `${TEST_REPO_PREFIX}v1`);
    expect(mine.length).toBe(1);
    expect(mine[0]!.keyId).toBeNull();
    expect(mine[0]!.keyName).toBeNull();
    expect(mine[0]!.endpoint).toBe('/api/v1/repos/[owner]/[name]');
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it('joins apiKey.name for authenticated rows and labels deleted keys as (deleted)', async () => {
    const { hash } = generateApiKey();
    const key = await prisma.apiKey.create({
      data: {
        userId: testUserId,
        name: `${TEST_KEY_LABEL_PREFIX}-named`,
        keyPrefix: 'ghc_',
        keyHash: hash,
        status: 'active',
      },
    });
    await recordRequest({
      endpoint: '/api/query',
      apiKeyId: key.id,
      cacheHit: false,
      durationMs: 42,
      statusCode: 200,
      repoRequested: `${TEST_REPO_PREFIX}auth`,
    });
    // Insert a row that points at a non-existent apiKeyId to exercise the
    // "(deleted)" fallback. We can't delete the row after the FK is
    // checked at insert time, so this just confirms the fallback path
    // by reading the same apiKeyId after deleting the parent key.
    await prisma.apiKey.delete({ where: { id: key.id } });
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 5_000);
    const { rows } = await recentRequests({ skip: 0, take: 50 }, { from, to });
    const mine = rows.filter((r) => r.repoRequested === `${TEST_REPO_PREFIX}auth`);
    expect(mine.length).toBe(1);
    // After key deletion the label falls back to (deleted) so the row
    // remains visible in the admin view.
    expect(mine[0]!.keyName).toBe('(deleted)');
  });

  it('respects pagination skip/take', async () => {
    for (let i = 0; i < 5; i++) {
      await recordRequest({
        endpoint: '/api/v1/repos/[owner]/[name]',
        cacheHit: true,
        durationMs: 10,
        statusCode: 200,
        repoRequested: `${TEST_REPO_PREFIX}page-${i}`,
      });
    }
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 5_000);
    const page1 = await recentRequests({ skip: 0, take: 2 }, { from, to });
    const page2 = await recentRequests({ skip: 2, take: 2 }, { from, to });
    const page1Mine = page1.rows.filter((r) =>
      r.repoRequested?.startsWith(`${TEST_REPO_PREFIX}page-`),
    );
    const page2Mine = page2.rows.filter((r) =>
      r.repoRequested?.startsWith(`${TEST_REPO_PREFIX}page-`),
    );
    // Both pages together should surface all 5 of our tagged rows.
    expect(page1Mine.length + page2Mine.length).toBeGreaterThanOrEqual(5);
    // And no row should appear on both pages.
    const ids1 = new Set(page1Mine.map((r) => r.id.toString()));
    for (const r of page2Mine) {
      expect(ids1.has(r.id.toString())).toBe(false);
    }
  });
});