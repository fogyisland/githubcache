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
});
