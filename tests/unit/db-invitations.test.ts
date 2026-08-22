import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createInvitation,
  findInvitationById,
  consumeInvitation,
  listInvitations,
} from '@/lib/db/invitations';
import { prisma } from '@/lib/db/client';

const TEST_EMAIL_PREFIX = 'db-inv-test-';
let testInviterId: bigint;

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}inviter-${Date.now()}@example.test`,
      role: 'admin',
    },
  });
  testInviterId = u.id;
});

afterAll(async () => {
  await prisma.invitation.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.invitation.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
});

describe('createInvitation', () => {
  it('creates an invitation with 32-char id and ~7-day TTL by default', async () => {
    const inv = await createInvitation(
      `${TEST_EMAIL_PREFIX}a-${Date.now()}@example.test`,
      'operator',
      testInviterId,
    );
    expect(inv.id).toHaveLength(32);
    const days = (inv.expiresAt.getTime() - Date.now()) / (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('honors custom ttlHours', async () => {
    const inv = await createInvitation(
      `${TEST_EMAIL_PREFIX}b-${Date.now()}@example.test`,
      'admin',
      testInviterId,
      1, // 1 hour
    );
    const hours = (inv.expiresAt.getTime() - Date.now()) / (3600 * 1000);
    expect(hours).toBeGreaterThan(0.9);
    expect(hours).toBeLessThan(1.1);
  });
});

describe('findInvitationById', () => {
  it('finds by id', async () => {
    const inv = await createInvitation(
      `${TEST_EMAIL_PREFIX}c-${Date.now()}@example.test`,
      'operator',
      testInviterId,
    );
    const found = await findInvitationById(inv.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(inv.id);
  });

  it('returns null for non-existent id', async () => {
    const found = await findInvitationById('a'.repeat(32));
    expect(found).toBeNull();
  });
});

describe('consumeInvitation', () => {
  it('consumes a valid invitation', async () => {
    const inv = await createInvitation(
      `${TEST_EMAIL_PREFIX}d-${Date.now()}@example.test`,
      'operator',
      testInviterId,
    );
    const consumed = await consumeInvitation(inv.id);
    expect(consumed).not.toBeNull();
    expect(consumed!.consumedAt).not.toBeNull();
  });

  it('returns null if already consumed', async () => {
    const inv = await createInvitation(
      `${TEST_EMAIL_PREFIX}e-${Date.now()}@example.test`,
      'operator',
      testInviterId,
    );
    await consumeInvitation(inv.id);
    const second = await consumeInvitation(inv.id);
    expect(second).toBeNull();
  });

  it('returns null if expired', async () => {
    const inv = await createInvitation(
      `${TEST_EMAIL_PREFIX}f-${Date.now()}@example.test`,
      'operator',
      testInviterId,
    );
    // Manually expire
    await prisma.invitation.update({
      where: { id: inv.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await consumeInvitation(inv.id);
    expect(result).toBeNull();
  });
});

describe('listInvitations', () => {
  it('lists all invitations ordered by createdAt desc', async () => {
    await createInvitation(
      `${TEST_EMAIL_PREFIX}g1-${Date.now()}@example.test`,
      'operator',
      testInviterId,
    );
    await new Promise((r) => setTimeout(r, 10));
    await createInvitation(
      `${TEST_EMAIL_PREFIX}g2-${Date.now()}@example.test`,
      'admin',
      testInviterId,
    );
    const list = await listInvitations();
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < list.length; i++) {
      expect(list[i]!.createdAt.getTime()).toBeLessThanOrEqual(list[i - 1]!.createdAt.getTime());
    }
  });
});
