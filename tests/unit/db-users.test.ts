import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { listUsers, getUserById, updateUserStatus, UserStatus } from '@/lib/db/users';
import { prisma } from '@/lib/db/client';

const TEST_EMAIL_PREFIX = 'db-users-test-';
const ACTOR_EMAIL_PREFIX = 'db-users-test-actor-';
const testUserIds: bigint[] = [];
let actorId: bigint;

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
  // M28.bug4a — updateUserStatus requires a positive actorUserId. Create
  // a long-lived admin actor used across the test suite.
  const actor = await prisma.user.create({
    data: {
      email: `${ACTOR_EMAIL_PREFIX}${Date.now()}@example.test`,
      role: 'admin',
    },
  });
  actorId = actor.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: ACTOR_EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Reset all test users to active before each test
  for (const id of testUserIds) {
    await prisma.user.update({ where: { id }, data: { status: UserStatus.Active } }).catch(() => {
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
    await updateUserStatus(id, UserStatus.Disabled, actorId);
    const user = await getUserById(id);
    expect(user!.status).toBe(UserStatus.Disabled);
  });

  it('updates status back to active', async () => {
    const id = testUserIds[1]!;
    await updateUserStatus(id, UserStatus.Disabled, actorId);
    await updateUserStatus(id, UserStatus.Active, actorId);
    const user = await getUserById(id);
    expect(user!.status).toBe(UserStatus.Active);
  });

  // M28.bug4a — updateUserStatus refuses to write without an actor.
  it('throws when actorUserId is missing or non-positive', async () => {
    const id = testUserIds[2]!;
    await expect(updateUserStatus(id, UserStatus.Disabled, 0n)).rejects.toThrow(
      /positive actorUserId/,
    );
  });

  // M31.x.b — restored the users_status_audit trigger in
  // migration 20260913000005 (with CREATE TRIGGER body installed
  // out-of-band via scripts/install-status-trigger.mjs). The trigger
  // writes a `user_status_changed_shadow` audit row for any UPDATE
  // that changes user_status, including direct SQL — see
  // tests/integration/admin-users-shadow-trigger.test.ts for the
  // trigger contract. In-app coverage of `disable_user` / `enable_user`
  // audit rows still lives in tests/integration/admin-users.test.ts
  // (lines 240, 262).
});
