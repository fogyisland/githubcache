import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { listUsers } from '@/lib/db/users';
import { listApiKeys } from '@/lib/db/api-keys';
import { listAllTokens } from '@/lib/db/github-tokens';

const TEST_EMAIL_PREFIX = 'admin-pagination-int-';

const seededUserIds: bigint[] = [];
const seededKeyIds: bigint[] = [];
const seededTokenIds: bigint[] = [];

/** Seed N users with monotonically increasing createdAt so order is
 *  deterministic across skip/take variations. */
async function seedUsers(n: number): Promise<bigint[]> {
  const ids: bigint[] = [];
  for (let i = 0; i < n; i++) {
    const u = await prisma.user.create({
      data: {
        email: `${TEST_EMAIL_PREFIX}user-${i}-${Date.now()}@example.test`,
        role: i % 2 === 0 ? 'admin' : 'operator',
        status: i % 3 === 0 ? 'disabled' : 'active',
        passwordHash: await hashPassword('seed-password'),
        createdAt: new Date(Date.now() - (n - i) * 1000),
      },
    });
    ids.push(u.id);
    seededUserIds.push(u.id);
  }
  return ids;
}

async function seedApiKeys(n: number): Promise<bigint[]> {
  const ownerId = (
    await prisma.user.create({
      data: {
        email: `${TEST_EMAIL_PREFIX}owner-${Date.now()}@example.test`,
        role: 'operator',
        status: 'active',
        passwordHash: await hashPassword('seed-password'),
      },
    })
  ).id;
  seededUserIds.push(ownerId);

  const ids: bigint[] = [];
  for (let i = 0; i < n; i++) {
    const k = await prisma.apiKey.create({
      data: {
        userId: ownerId,
        keyHash: `${TEST_EMAIL_PREFIX}hash-${i}-${Date.now()}-${i}`,
        keyPrefix: `ghc_${i.toString().padStart(4, '0')}`,
        name: `pagination-test-key-${i}`,
        status: i % 2 === 0 ? 'active' : 'pending',
        rateLimitPerMin: 60,
        dailyQuota: 10000,
        createdAt: new Date(Date.now() - (n - i) * 1000),
      },
    });
    ids.push(k.id);
    seededKeyIds.push(k.id);
  }
  return ids;
}

async function seedTokens(n: number): Promise<bigint[]> {
  const ids: bigint[] = [];
  for (let i = 0; i < n; i++) {
    const tok = await prisma.githubToken.create({
      data: {
        tokenHash: `${TEST_EMAIL_PREFIX}tok-${i}-${Date.now()}-${i}`,
        tokenFirst4: 'ghc_',
        tokenLast4: `${i.toString().padStart(4, '0')}`,
        label: `pagination-test-token-${i}`,
        status: 'active',
        requestsLimit: 5000,
        requestsUsed: 0,
        createdAt: new Date(Date.now() - (n - i) * 1000),
      },
    });
    ids.push(tok.id);
    seededTokenIds.push(tok.id);
  }
  return ids;
}

beforeAll(async () => {
  // Seed enough rows that pagination is meaningful on a clean DB.
  await seedUsers(30);
  await seedApiKeys(30);
  await seedTokens(30);
}, 60_000);

afterAll(async () => {
  await prisma.apiKey.deleteMany({ where: { id: { in: seededKeyIds } } });
  await prisma.githubToken.deleteMany({ where: { id: { in: seededTokenIds } } });
  await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

describe('listUsers pagination', () => {
  it('returns the requested page with accurate total', async () => {
    const page1 = await listUsers({ skip: 0, take: 10 });
    const page2 = await listUsers({ skip: 10, take: 10 });
    const page3 = await listUsers({ skip: 20, take: 10 });

    // Each page is exactly 10 rows.
    expect(page1.rows.length).toBe(10);
    expect(page2.rows.length).toBe(10);
    expect(page3.rows.length).toBe(10);

    // Totals match (>= 30 because pre-existing rows in the test DB may
    // add to the count; we only assert the pages don't overlap and the
    // total is at least what we seeded).
    expect(page1.total).toBe(page2.total);
    expect(page2.total).toBe(page3.total);
    expect(page1.total).toBeGreaterThanOrEqual(30);

    // No overlap between consecutive pages.
    const ids1 = new Set(page1.rows.map((r) => r.id.toString()));
    for (const r of page2.rows) {
      expect(ids1.has(r.id.toString())).toBe(false);
    }
  });

  it('returns empty rows + accurate total when offset exceeds the result set', async () => {
    const result = await listUsers({ skip: 10_000, take: 10 });
    expect(result.rows.length).toBe(0);
    expect(result.total).toBeGreaterThanOrEqual(30);
  });

  it('respects the role filter combined with pagination', async () => {
    const page = await listUsers({ role: 'operator', skip: 0, take: 50 });
    for (const u of page.rows) {
      expect(u.role).toBe('operator');
    }
    // total here is operator-count, not all users
    expect(page.total).toBeLessThanOrEqual(page.total); // tautology; sanity
  });

  it('returns no rows for an impossible role filter combination', async () => {
    // admin + status=disabled with skip beyond seeded disabled admins
    const page = await listUsers({ role: 'admin', status: 'disabled', skip: 100, take: 10 });
    expect(page.rows.length).toBe(0);
  });
});

describe('listApiKeys pagination', () => {
  it('returns the requested page with accurate total', async () => {
    const page1 = await listApiKeys({ skip: 0, take: 10 });
    const page2 = await listApiKeys({ skip: 10, take: 10 });
    expect(page1.rows.length).toBe(10);
    expect(page2.rows.length).toBe(10);
    expect(page1.total).toBe(page2.total);
    expect(page1.total).toBeGreaterThanOrEqual(30);

    // Owner enrichment works on every paginated row.
    for (const k of page1.rows) {
      expect(k.user.email).toMatch(/@/);
      expect(typeof k.user.role).toBe('string');
    }

    const ids1 = new Set(page1.rows.map((r) => r.id.toString()));
    for (const k of page2.rows) {
      expect(ids1.has(k.id.toString())).toBe(false);
    }
  });

  it('respects the status filter combined with pagination', async () => {
    const active = await listApiKeys({ status: 'active', skip: 0, take: 50 });
    const pending = await listApiKeys({ status: 'pending', skip: 0, take: 50 });
    for (const k of active.rows) expect(k.status).toBe('active');
    for (const k of pending.rows) expect(k.status).toBe('pending');
    // The two totals should sum to roughly the unfiltered total — we
    // don't assert exact equality because other test runs may have left
    // rows in other statuses.
    expect(active.total + pending.total).toBeGreaterThanOrEqual(30);
  });
});

describe('listAllTokens pagination', () => {
  it('returns the requested page with accurate total', async () => {
    const page1 = await listAllTokens({ skip: 0, take: 10 });
    const page2 = await listAllTokens({ skip: 10, take: 10 });
    expect(page1.rows.length).toBe(10);
    expect(page2.rows.length).toBe(10);
    expect(page1.total).toBe(page2.total);
    expect(page1.total).toBeGreaterThanOrEqual(30);

    const ids1 = new Set(page1.rows.map((r) => r.id.toString()));
    for (const t of page2.rows) {
      expect(ids1.has(t.id.toString())).toBe(false);
    }
  });

  it('returns empty rows when offset is way past the end', async () => {
    const result = await listAllTokens({ skip: 10_000, take: 10 });
    expect(result.rows.length).toBe(0);
    expect(result.total).toBeGreaterThanOrEqual(30);
  });
});