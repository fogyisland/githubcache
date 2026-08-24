import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { changePassword } from '@/lib/auth/password-reset';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession, findSessionById } from '@/lib/db/sessions';
import { prisma } from '@/lib/db/client';

const TEST_EMAIL_PREFIX = 'password-reset-';
let testUserId: bigint;

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}u-${Date.now()}@example.test`,
      role: 'admin',
      status: 'active',
      passwordHash: await hashPassword('original-password'),
    },
  });
  testUserId = u.id;
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: testUserId } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: testUserId },
        { targetId: String(testUserId) },
      ],
    },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Reset password hash + delete any leftover sessions before each test
  await prisma.user.update({
    where: { id: testUserId },
    data: { passwordHash: await hashPassword('original-password') },
  });
  await prisma.session.deleteMany({ where: { userId: testUserId } });
});

describe('changePassword', () => {
  it('updates the password hash', async () => {
    await changePassword(testUserId, 'new-password-123', testUserId);
    const user = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(user?.passwordHash).toBeTruthy();
    expect(await verifyPassword('new-password-123', user!.passwordHash!)).toBe(true);
    expect(await verifyPassword('original-password', user!.passwordHash!)).toBe(false);
  }, 15_000);

  it('invalidates ALL sessions for the user', async () => {
    // Create 3 sessions
    await createSession(testUserId);
    await createSession(testUserId);
    await createSession(testUserId);
    const before = await prisma.session.count({ where: { userId: testUserId } });
    expect(before).toBe(3);

    await changePassword(testUserId, 'new-password-123', testUserId);

    const after = await prisma.session.count({ where: { userId: testUserId } });
    expect(after).toBe(0);
  }, 15_000);

  it('invalidated sessions cannot be validated by findSessionById', async () => {
    const { id } = await createSession(testUserId);
    await changePassword(testUserId, 'new-password-123', testUserId);
    const result = await findSessionById(id);
    expect(result).toBeNull();
  }, 15_000);

  it('writes audit_log entry (action=password_changed) with actorUserId = explicit actor', async () => {
    await changePassword(testUserId, 'new-password-456', testUserId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'password_changed', targetId: String(testUserId) },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.actorUserId).toBe(testUserId);
  }, 15_000);

  it('records the admin as actor when actorUserId differs from target (reset-password scenario)', async () => {
    // Simulate an admin resetting another user's password.
    // `testUserId` is the target, but we pass a different BigInt as actor.
    const actorId = testUserId + 99n;
    await changePassword(testUserId, 'new-password-admin', actorId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'password_changed', targetId: String(testUserId) },
      orderBy: { id: 'desc' },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    // The most recent audit must record the admin, NOT the target.
    expect(audits[0]!.actorUserId).toBe(actorId);
    expect(audits[0]!.actorUserId).not.toBe(testUserId);
  }, 15_000);

  it('does not affect other users\' sessions', async () => {
    // Create another user with their own sessions
    const otherUser = await prisma.user.create({
      data: {
        email: `${TEST_EMAIL_PREFIX}other-${Date.now()}@example.test`,
        role: 'operator',
        status: 'active',
        passwordHash: await hashPassword('other-password'),
      },
    });
    try {
      await createSession(otherUser.id);
      await createSession(testUserId);
      const before = await prisma.session.count({ where: { userId: otherUser.id } });
      expect(before).toBe(1);

      await changePassword(testUserId, 'new-password-789', testUserId);

      const otherAfter = await prisma.session.count({ where: { userId: otherUser.id } });
      expect(otherAfter).toBe(1); // unchanged
      const mineAfter = await prisma.session.count({ where: { userId: testUserId } });
      expect(mineAfter).toBe(0);
    } finally {
      await prisma.session.deleteMany({ where: { userId: otherUser.id } });
      await prisma.user.delete({ where: { id: otherUser.id } });
    }
  }, 15_000);
});
