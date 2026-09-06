import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';

const TEST_EMAIL_PREFIX = 'admin-api-keys-self-int-';

let operatorId: bigint;

beforeAll(async () => {
  const operator = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}op-${Date.now()}@example.test`,
      role: 'operator',
      status: 'active',
      passwordHash: await hashPassword('pw'),
      signupSource: 'self',
    },
  });
  operatorId = operator.id;

  // Seed one self-requested key (prefix 'ghc_usr_…') and one
  // admin-created key (prefix 'ghc_live_…').
  await prisma.apiKey.createMany({
    data: [
      {
        userId: operatorId,
        name: 'self-requested',
        keyPrefix: 'ghc_usr_abcd',
        keyHash: `self-${Date.now()}`,
        status: 'pending',
      },
      {
        userId: operatorId,
        name: 'admin-created',
        keyPrefix: 'ghc_live_xyzw',
        keyHash: `admin-${Date.now()}`,
        status: 'active',
        approvedAt: new Date(),
      },
    ],
  });
});

afterAll(async () => {
  await prisma.apiKey.deleteMany({ where: { userId: operatorId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

describe('admin api-keys page sees both admin-created and self-requested keys', () => {
  it('returns both keyPrefixes from listApiKeys', async () => {
    const { listApiKeys } = await import('@/lib/db/api-keys');
    const result = await listApiKeys({ skip: 0, take: 100 });
    const mine = result.rows.filter((k) => k.userId === operatorId);
    expect(mine.length).toBe(2);
    const prefixes = mine.map((k) => k.keyPrefix).sort();
    expect(prefixes).toContain('ghc_usr_abcd');
    expect(prefixes).toContain('ghc_live_xyzw');
  });

  it('all rows carry the owner email so the admin UI can render it', async () => {
    const { listApiKeys } = await import('@/lib/db/api-keys');
    const result = await listApiKeys({ skip: 0, take: 100 });
    const mine = result.rows.filter((k) => k.userId === operatorId);
    for (const row of mine) {
      expect(row.user.email).toMatch(/@example\.test$/);
    }
  });

  it('admin status filter still works for self-requested keys', async () => {
    const { listApiKeys } = await import('@/lib/db/api-keys');
    const result = await listApiKeys({ status: 'pending', skip: 0, take: 100 });
    const mine = result.rows.filter((k) => k.userId === operatorId);
    expect(mine.length).toBe(1);
    expect(mine[0]!.name).toBe('self-requested');
  });
});
