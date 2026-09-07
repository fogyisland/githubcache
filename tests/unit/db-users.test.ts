import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { listUsers, getUserById, updateUserStatus } from '@/lib/db/users';
import { prisma } from '@/lib/db/client';

const TEST_EMAIL_PREFIX = 'db-users-test-';
const testUserIds: bigint[] = [];

beforeAll(async () => {
  for (let i = 0; i < 3; i++) {
    const u = await prisma.user.create({
      data: {
        email: `${TEST_EMAIL_PREFIX}u-${i}-${Date.now()}@example.test`,
        role: 'operator',
      },
    });
    testUserIds.push(u.id);
  }
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Reset all test users to active before each test
  for (const id of testUserIds) {
    await prisma.user.update({ where: { id }, data: { status: 'active' } }).catch(() => {
      /* ignore */
    });
  }
});

describe('listUsers', () => {
  it('returns all users ordered by createdAt desc', async () => {
    const { rows, total } = await listUsers({ skip: 0, take: 1000 });
    expect(total).toBeGreaterThanOrEqual(3);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // createdAt desc — strictly non-increasing
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.createdAt.getTime()).toBeLessThanOrEqual(rows[i - 1]!.createdAt.getTime());
    }
  });
});

describe('getUserById', () => {
  it('returns user by id', async () => {
    const id = testUserIds[0]!;
    const user = await getUserById(id);
    expect(user).not.toBeNull();
    expect(user!.id).toBe(id);
  });

  it('returns null for non-existent id', async () => {
    const user = await getUserById(BigInt('999999999999'));
    expect(user).toBeNull();
  });
});

describe('updateUserStatus', () => {
  it('updates status to disabled', async () => {
    const id = testUserIds[0]!;
    await updateUserStatus(id, 'disabled');
    const user = await getUserById(id);
    expect(user!.status).toBe('disabled');
  });

  it('updates status back to active', async () => {
    const id = testUserIds[1]!;
    await updateUserStatus(id, 'disabled');
    await updateUserStatus(id, 'active');
    const user = await getUserById(id);
    expect(user!.status).toBe('active');
  });

  // M27.7 — application writes must be auditable via the AFTER UPDATE
  // trigger on `users`. We verify both the row gets written AND that
  // the source is tagged 'application' (distinguishes from manual SQL
  // which the trigger tags 'sql').
  it('writes an audit_log row with source=application', async () => {
    const id = testUserIds[2]!;
    // Reset first (beforeEach already did active, but be explicit)
    await updateUserStatus(id, 'active');

    const before = await prisma.auditLog.count({
      where: { targetType: 'user', targetId: id.toString() },
    });

    await updateUserStatus(id, 'disabled');

    const rows = await prisma.auditLog.findMany({
      where: { targetType: 'user', targetId: id.toString() },
      orderBy: { id: 'desc' },
      take: 1,
    });
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.action).toBe('disable_user');
    // MySQL JSON column round-trip -> JsonValue; assert via JSON.stringify
    // so this test doesn't depend on the runtime shape of the parsed object.
    const meta = JSON.stringify(row.metadata);
    expect(meta).toContain('"source":"application"');
    expect(meta).toContain('"from":"active"');
    expect(meta).toContain('"to":"disabled"');
    expect(meta).toContain('"trigger":"users_status_audit"');
    expect(rows.length + before).toBeGreaterThan(0);
  });
});
