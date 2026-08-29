import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { listApiKeys, getApiKeyById, updateApiKeyLimits } from '@/lib/db/api-keys';
import { prisma } from '@/lib/db/client';

const TEST_EMAIL_PREFIX = 'db-apikeys-test-';
// keyPrefix column is VarChar(16); keep total < 13 chars
const TEST_API_KEY_PREFIX = 'dbak';

let ownerUserId: bigint;
let adminUserId: bigint;
const testKeyIds: bigint[] = [];

beforeAll(async () => {
  // Owner (operator) — most keys belong to this user
  const owner = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}owner-${Date.now()}@example.test`,
      role: 'operator',
      status: 'active',
    },
  });
  ownerUserId = owner.id;

  // Admin (different owner — used to verify the join shows the correct user)
  const admin = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`,
      role: 'admin',
      status: 'active',
    },
  });
  adminUserId = admin.id;
}, 30_000);

afterAll(async () => {
  // Clean up: delete RequestLog rows for our keys, then keys, then users
  await prisma.requestLog.deleteMany({
    where: { apiKeyId: { in: testKeyIds } },
  });
  await prisma.apiKey.deleteMany({
    where: { id: { in: testKeyIds } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Wipe any leftover keys from previous tests, then create a fresh set
  await prisma.requestLog.deleteMany({
    where: { apiKeyId: { in: testKeyIds } },
  });
  await prisma.apiKey.deleteMany({
    where: { id: { in: testKeyIds } },
  });
  testKeyIds.length = 0;

  // 3 keys for owner (pending/active/revoked) + 1 key for admin (pending)
  // Insert in time-separated order so createdAt ordering is deterministic
  const k1 = await prisma.apiKey.create({
    data: {
      userId: ownerUserId,
      name: 'owner-pending',
      keyPrefix: `${TEST_API_KEY_PREFIX}op-pending`,
      keyHash: `hash-pending-${Date.now()}-${Math.random()}`,
      status: 'pending',
    },
  });
  testKeyIds.push(k1.id);

  await new Promise((r) => setTimeout(r, 5));

  const k2 = await prisma.apiKey.create({
    data: {
      userId: ownerUserId,
      name: 'owner-active',
      keyPrefix: `${TEST_API_KEY_PREFIX}op-active`,
      keyHash: `hash-active-${Date.now()}-${Math.random()}`,
      status: 'active',
    },
  });
  testKeyIds.push(k2.id);

  await new Promise((r) => setTimeout(r, 5));

  const k3 = await prisma.apiKey.create({
    data: {
      userId: ownerUserId,
      name: 'owner-revoked',
      keyPrefix: `${TEST_API_KEY_PREFIX}op-revoked`,
      keyHash: `hash-revoked-${Date.now()}-${Math.random()}`,
      status: 'revoked',
      revokedAt: new Date(),
    },
  });
  testKeyIds.push(k3.id);

  await new Promise((r) => setTimeout(r, 5));

  const k4 = await prisma.apiKey.create({
    data: {
      userId: adminUserId,
      name: 'admin-pending',
      keyPrefix: `${TEST_API_KEY_PREFIX}ad-pend`,
      keyHash: `hash-admin-${Date.now()}-${Math.random()}`,
      status: 'pending',
    },
  });
  testKeyIds.push(k4.id);
});

describe('listApiKeys', () => {
  it('returns all keys with user joined when no filter is given', async () => {
    const keys = await listApiKeys({ skip: 0, take: 1000 });
    // At minimum we have our 4 test keys (other tests may have left rows;
    // we only assert ours are present and well-formed)
    const ourKeys = keys.rows.filter((k) => k.keyPrefix.startsWith(TEST_API_KEY_PREFIX));
    expect(ourKeys).toHaveLength(4);
    for (const k of ourKeys) {
      expect(k.user).toBeDefined();
      expect(k.user.id).toBeDefined();
      expect(typeof k.user.email).toBe('string');
      expect(['admin', 'operator']).toContain(k.user.role);
    }
  });

  it('filters by status (pending / active / revoked)', async () => {
    const pending = await listApiKeys({ status: 'pending', skip: 0, take: 1000 });
    const ourPending = pending.rows.filter((k) => k.keyPrefix.startsWith(TEST_API_KEY_PREFIX));
    expect(ourPending).toHaveLength(2);
    for (const k of ourPending) {
      expect(k.status).toBe('pending');
    }

    const active = await listApiKeys({ status: 'active', skip: 0, take: 1000 });
    const ourActive = active.rows.filter((k) => k.keyPrefix.startsWith(TEST_API_KEY_PREFIX));
    expect(ourActive).toHaveLength(1);
    expect(ourActive[0]!.name).toBe('owner-active');

    const revoked = await listApiKeys({ status: 'revoked', skip: 0, take: 1000 });
    const ourRevoked = revoked.rows.filter((k) => k.keyPrefix.startsWith(TEST_API_KEY_PREFIX));
    expect(ourRevoked).toHaveLength(1);
    expect(ourRevoked[0]!.name).toBe('owner-revoked');
  });

  it('orders by createdAt desc', async () => {
    const keys = await listApiKeys({ skip: 0, take: 1000 });
    const ourKeys = keys.rows.filter((k) => k.keyPrefix.startsWith(TEST_API_KEY_PREFIX));
    expect(ourKeys).toHaveLength(4);
    // Newest first — strictly non-increasing
    for (let i = 1; i < ourKeys.length; i++) {
      expect(ourKeys[i]!.createdAt.getTime()).toBeLessThanOrEqual(
        ourKeys[i - 1]!.createdAt.getTime(),
      );
    }
    // The most recently created key should be admin-pending (k4)
    expect(ourKeys[0]!.name).toBe('admin-pending');
  });
});

describe('getApiKeyById', () => {
  it('returns the key with user + requestCountLast24h', async () => {
    const id = testKeyIds[1]!; // owner-active
    const key = await getApiKeyById(id);
    expect(key).not.toBeNull();
    expect(key!.id).toBe(id);
    expect(key!.status).toBe('active');
    expect(key!.user.id).toBe(ownerUserId);
    expect(typeof key!.requestCountLast24h).toBe('number');
    expect(key!.requestCountLast24h).toBe(0); // no RequestLog rows yet
  });

  it('counts RequestLog rows from the last 24 hours', async () => {
    const id = testKeyIds[1]!; // owner-active
    // Insert 3 recent log rows
    await prisma.requestLog.createMany({
      data: [
        { apiKeyId: id, endpoint: '/query', cacheHit: true, durationMs: 5, statusCode: 200 },
        { apiKeyId: id, endpoint: '/query', cacheHit: true, durationMs: 5, statusCode: 200 },
        { apiKeyId: id, endpoint: '/query', cacheHit: false, durationMs: 50, statusCode: 200 },
      ],
    });
    // Insert 1 OLD log row (>24h ago) — should NOT be counted
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await prisma.requestLog.create({
      data: {
        apiKeyId: id,
        endpoint: '/query',
        cacheHit: true,
        durationMs: 5,
        statusCode: 200,
        createdAt: old,
      },
    });

    const key = await getApiKeyById(id);
    expect(key!.requestCountLast24h).toBe(3);
  });

  it('returns null for a non-existent id', async () => {
    const key = await getApiKeyById(BigInt('999999999999'));
    expect(key).toBeNull();
  });
});

describe('updateApiKeyLimits', () => {
  it('updates rateLimitPerMin + dailyQuota, returns the updated row', async () => {
    const id = testKeyIds[1]!; // owner-active, defaults rate=60 quota=10000
    const before = await prisma.apiKey.findUnique({ where: { id } });
    expect(before!.rateLimitPerMin).toBe(60);
    expect(before!.dailyQuota).toBe(10000);

    const updated = await updateApiKeyLimits(id, { rateLimitPerMin: 120, dailyQuota: 50000 });
    expect(updated.id).toBe(id);
    expect(updated.rateLimitPerMin).toBe(120);
    expect(updated.dailyQuota).toBe(50000);

    // Re-read from DB to confirm persisted
    const after = await prisma.apiKey.findUnique({ where: { id } });
    expect(after!.rateLimitPerMin).toBe(120);
    expect(after!.dailyQuota).toBe(50000);
  });
});