import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit/bucket';
import { incrementBucket, windowStartFor } from '@/lib/db/rate-limit';
import { generateApiKey } from '@/lib/api-keys/generate';

const TEST_USER_PREFIX = 'rl-durable-';
let testUserId = 0n;
let testApiKeyId = 0n;

async function createTestKey(): Promise<bigint> {
  const plain = generateApiKey();
  const created = await prisma.apiKey.create({
    data: {
      userId: testUserId,
      name: `rl-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      keyPrefix: plain.prefix,
      keyHash: plain.hash,
      status: 'active',
    },
  });
  return created.id;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `${TEST_USER_PREFIX}${Date.now()}@example.test`,
      role: 'admin',
      status: 'active',
    },
  });
  testUserId = user.id;
});

afterAll(async () => {
  // Cascade delete keys (and via FK CASCADE, their buckets)
  const authUsers = await prisma.user.findMany({
    where: { email: { startsWith: TEST_USER_PREFIX } },
    select: { id: true },
  });
  const userIds = authUsers.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.apiKey.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({
      where: { actorUserId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Clean up all keys for test users so each test starts with a fresh bucket state
  await prisma.rateLimitBucket.deleteMany({
    where: { apiKey: { userId: testUserId } },
  });
  await prisma.apiKey.deleteMany({ where: { userId: testUserId } });
});

describe('checkRateLimit (durable bucket)', () => {
  it('allows the first request and counts it as 1', async () => {
    testApiKeyId = await createTestKey();
    const r = await checkRateLimit(testApiKeyId, 60);
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
    expect(r.limit).toBe(60);
    expect(r.retryAfterSeconds).toBe(0);
  });

  it('allows up to perMinute requests within the window', async () => {
    testApiKeyId = await createTestKey();
    const perMinute = 5;
    for (let i = 0; i < perMinute; i++) {
      const r = await checkRateLimit(testApiKeyId, perMinute);
      expect(r.allowed).toBe(true);
      expect(r.count).toBe(i + 1);
    }
  });

  it('denies the (perMinute + 1)-th request', async () => {
    testApiKeyId = await createTestKey();
    const perMinute = 3;
    for (let i = 0; i < perMinute; i++) {
      const r = await checkRateLimit(testApiKeyId, perMinute);
      expect(r.allowed).toBe(true);
    }
    const r = await checkRateLimit(testApiKeyId, perMinute);
    expect(r.allowed).toBe(false);
    expect(r.count).toBe(perMinute + 1);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('window resets when windowStart is stale (new wall-clock minute)', async () => {
    testApiKeyId = await createTestKey();
    const perMinute = 2;

    // Fill the bucket
    expect((await checkRateLimit(testApiKeyId, perMinute)).allowed).toBe(true);
    expect((await checkRateLimit(testApiKeyId, perMinute)).allowed).toBe(true);
    expect((await checkRateLimit(testApiKeyId, perMinute)).allowed).toBe(false);

    // Simulate window rollover: directly update windowStart to a stale past value.
    // Next checkRateLimit call computes a fresh windowStart (now-truncated-to-minute)
    // and the upsert resets count = 1 because windowStart != existing windowStart.
    const now = new Date();
    const staleStart = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago
    await prisma.rateLimitBucket.update({
      where: { apiKeyId: testApiKeyId },
      data: { windowStart: staleStart },
    });

    const r = await checkRateLimit(testApiKeyId, perMinute);
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
  });

  it('retryAfterSeconds is positive when denied', async () => {
    testApiKeyId = await createTestKey();
    const perMinute = 1;
    await checkRateLimit(testApiKeyId, perMinute);
    const r = await checkRateLimit(testApiKeyId, perMinute);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('is atomic under concurrent calls — exactly perMinute succeed', async () => {
    testApiKeyId = await createTestKey();
    const perMinute = 10;
    const total = 100;
    const results = await Promise.all(
      Array.from({ length: total }, () => checkRateLimit(testApiKeyId, perMinute)),
    );
    const allowedCount = results.filter((r) => r.allowed).length;
    const deniedCount = results.filter((r) => !r.allowed).length;
    expect(allowedCount).toBe(perMinute);
    expect(deniedCount).toBe(total - perMinute);
    // Final count in DB must equal total (every increment is atomic)
    const final = await prisma.rateLimitBucket.findUnique({
      where: { apiKeyId: testApiKeyId },
    });
    expect(final?.count).toBe(total);
  });

  it('cascades delete when the API key is deleted', async () => {
    testApiKeyId = await createTestKey();
    await checkRateLimit(testApiKeyId, 5);
    const before = await prisma.rateLimitBucket.findUnique({
      where: { apiKeyId: testApiKeyId },
    });
    expect(before).not.toBeNull();

    await prisma.apiKey.delete({ where: { id: testApiKeyId } });
    const after = await prisma.rateLimitBucket.findUnique({
      where: { apiKeyId: testApiKeyId },
    });
    expect(after).toBeNull();
  });

  it('per-key isolation — one key filling does not affect another', async () => {
    const keyA = await createTestKey();
    const keyB = await createTestKey();
    const perMinute = 2;

    expect((await checkRateLimit(keyA, perMinute)).allowed).toBe(true);
    expect((await checkRateLimit(keyA, perMinute)).allowed).toBe(true);
    expect((await checkRateLimit(keyA, perMinute)).allowed).toBe(false);

    // keyB is independent
    expect((await checkRateLimit(keyB, perMinute)).allowed).toBe(true);
    expect((await checkRateLimit(keyB, perMinute)).allowed).toBe(true);
    expect((await checkRateLimit(keyB, perMinute)).allowed).toBe(false);
  });
});

describe('incrementBucket (DB helper)', () => {
  it('inserts row with count=1 when no row exists', async () => {
    testApiKeyId = await createTestKey();
    const windowStart = windowStartFor(new Date());
    const count = await incrementBucket(testApiKeyId, windowStart);
    expect(count).toBe(1);

    const row = await prisma.rateLimitBucket.findUnique({
      where: { apiKeyId: testApiKeyId },
    });
    expect(row?.count).toBe(1);
    expect(row?.windowStart.getTime()).toBe(windowStart.getTime());
  });

  it('increments existing row when windowStart matches', async () => {
    testApiKeyId = await createTestKey();
    const windowStart = windowStartFor(new Date());
    await incrementBucket(testApiKeyId, windowStart);
    await incrementBucket(testApiKeyId, windowStart);
    const count = await incrementBucket(testApiKeyId, windowStart);
    expect(count).toBe(3);
  });

  it('resets count when windowStart differs (new window)', async () => {
    testApiKeyId = await createTestKey();
    const oldWindow = new Date(Date.now() - 5 * 60 * 1000);
    await incrementBucket(testApiKeyId, oldWindow);
    const newWindow = windowStartFor(new Date());
    const count = await incrementBucket(testApiKeyId, newWindow);
    expect(count).toBe(1);
    const row = await prisma.rateLimitBucket.findUnique({
      where: { apiKeyId: testApiKeyId },
    });
    expect(row?.count).toBe(1);
    expect(row?.windowStart.getTime()).toBe(newWindow.getTime());
  });
});
