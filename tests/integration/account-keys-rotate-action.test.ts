import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';
import { generateSessionId } from '@/lib/db/sessions';
import type { User, ApiKey } from '@prisma/client';

const TEST_EMAIL_PREFIX = 'account-keys-rotate-int-';
const TEST_EMAIL = `${TEST_EMAIL_PREFIX}user-${Date.now()}@example.test`;

let operator: User;
let sessionId: string;

const cookieState = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => Array.from(cookieState.entries()).map(([name, value]) => ({ name, value })),
    get: (name: string) =>
      cookieState.has(name) ? { value: cookieState.get(name)! } : undefined,
    set: (opts: { name: string; value: string }) => {
      cookieState.set(opts.name, opts.value);
    },
  }),
  headers: () => ({
    get: (name: string) => {
      const n = name.toLowerCase();
      if (n === 'x-forwarded-for') return '203.0.113.7';
      if (n === 'host') return 'cache.test';
      return null;
    },
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`__redirect:${url}`);
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

const sendKeyRotatedMock = vi.fn();
vi.mock('@/lib/email/triggers/key-rotated', () => ({
  sendKeyRotatedEmail: (...args: unknown[]) => sendKeyRotatedMock(...args),
}));

let mockOperatorId = 1n;
vi.mock('@/lib/auth/session', () => ({
  validateSession: async () => ({
    id: mockOperatorId,
    email: TEST_EMAIL,
    role: 'operator',
    status: 0,
    passwordHash: '',
    theme: 'terminal',
    adminVariant: 'mission_control',
    lang: 'en',
    timezone: 'UTC',
    createdAt: new Date(),
    lastLoginAt: null,
    signupSource: 'self',
  }),
  SESSION_COOKIE_NAME: 'ghc_admin_sid',
}));

import { rotateOwnKeyAction } from '@/app/account/keys/[id]/_actions/rotate';

async function makeActiveKey(name: string): Promise<ApiKey> {
  // Pre-hashed via sha256 of a fake plaintext — what matters for the
  // action is that the key exists with status='active'.
  const fakePlain = `ghc_usr_${name}-fake-${Date.now()}`;
  const hash = createHash('sha256').update(fakePlain).digest('hex');
  const created = await prisma.apiKey.create({
    data: {
      userId: operator.id,
      name,
      keyPrefix: 'ghc_usr_',
      keyHash: hash,
      status: 'active',
      approvedAt: new Date(),
    },
  });
  await prisma.apiKey.update({
    where: { id: created.id },
    data: { keyPrefix: 'ghc_usr_' + hash.slice(0, 4) },
  });
  return prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
}

beforeAll(async () => {
  operator = await prisma.user.create({
    data: {
      email: TEST_EMAIL,
      role: 'operator',
      status: 0,
      passwordHash: await hashPassword('pw'),
      signupSource: 'self',
    },
  });
  mockOperatorId = operator.id;
  sessionId = generateSessionId();
  await prisma.session.create({
    data: {
      id: sessionId,
      userId: operator.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  cookieState.set('ghc_admin_sid', sessionId);
});

afterAll(async () => {
  await prisma.apiKey.deleteMany({ where: { userId: operator.id } });
  await prisma.auditLog.deleteMany({
    where: { actorUserId: operator.id, action: 'rotate_key_self' },
  });
  await prisma.session.deleteMany({ where: { userId: operator.id } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  sendKeyRotatedMock.mockReset();
  sendKeyRotatedMock.mockResolvedValue({ ok: true });
  // Wipe any keys + rotate audits so the cooldown test is deterministic.
  await prisma.apiKey.deleteMany({ where: { userId: operator.id } });
  await prisma.auditLog.deleteMany({
    where: { actorUserId: operator.id, action: 'rotate_key_self' },
  });
});

function formDataFor(keyId: bigint): FormData {
  const fd = new FormData();
  fd.set('keyId', keyId.toString());
  return fd;
}

describe('rotateOwnKeyAction', () => {
  it('revokes the old key and creates a new pending key with sha256 hash', async () => {
    const oldKey = await makeActiveKey('bot-key-1');

    const result = await rotateOwnKeyAction(formDataFor(oldKey.id));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plaintext.startsWith('ghc_usr_')).toBe(true);
    expect(result.newKeyName).toBe('bot-key-1 (rotated)');

    // Old key is now revoked.
    const refreshedOld = await prisma.apiKey.findUniqueOrThrow({ where: { id: oldKey.id } });
    expect(refreshedOld.status).toBe('revoked');
    expect(refreshedOld.revokedAt).not.toBeNull();

    // New key row exists, pending, with a sha256(plaintext) hash.
    const newKey = await prisma.apiKey.findUniqueOrThrow({ where: { id: BigInt(result.newKeyId) } });
    expect(newKey.status).toBe('pending');
    expect(newKey.userId).toBe(operator.id);
    expect(newKey.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(newKey.keyHash).toBe(createHash('sha256').update(result.plaintext).digest('hex'));
  });

  it('writes a rotate_key_self audit row referencing both keys', async () => {
    const oldKey = await makeActiveKey('bot-key-2');
    const result = await rotateOwnKeyAction(formDataFor(oldKey.id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const audits = await prisma.auditLog.findMany({
      where: { actorUserId: operator.id, action: 'rotate_key_self' },
    });
    expect(audits.length).toBe(1);
    const audit = audits[0]!;
    expect(audit.targetId).toBe(oldKey.id.toString());
    // Prisma's Json column comes back as an already-parsed object (or null).
    const metadata = (audit.metadata ?? {}) as {
      oldKeyName?: string;
      newKeyId?: string;
    };
    expect(metadata.oldKeyName).toBe('bot-key-2');
    expect(metadata.newKeyId).toBe(result.newKeyId);
  });

  it('triggers sendKeyRotatedEmail', async () => {
    const oldKey = await makeActiveKey('bot-key-3');
    await rotateOwnKeyAction(formDataFor(oldKey.id));
    expect(sendKeyRotatedMock).toHaveBeenCalledTimes(1);
    const args = sendKeyRotatedMock.mock.calls[0]![0] as {
      oldKey: { name: string };
      newKey: { name: string };
      origin: string;
    };
    expect(args.oldKey.name).toBe('bot-key-3');
    expect(args.newKey.name).toBe('bot-key-3 (rotated)');
    expect(args.origin).toContain('http://cache.test');
  });

  it('refuses with not_active when the key is pending', async () => {
    const fakePlain = `ghc_usr_pending-${Date.now()}`;
    const hash = createHash('sha256').update(fakePlain).digest('hex');
    const pendingKey = await prisma.apiKey.create({
      data: {
        userId: operator.id,
        name: 'pending-key',
        keyPrefix: 'ghc_usr_',
        keyHash: hash,
        status: 'pending',
      },
    });

    const result = await rotateOwnKeyAction(formDataFor(pendingKey.id));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_active');

    // Pending key is untouched.
    const stillThere = await prisma.apiKey.findUniqueOrThrow({ where: { id: pendingKey.id } });
    expect(stillThere.status).toBe('pending');
    expect(stillThere.revokedAt).toBeNull();
  });

  it('refuses with not_active when the key is already revoked', async () => {
    const fakePlain = `ghc_usr_revoked-${Date.now()}`;
    const hash = createHash('sha256').update(fakePlain).digest('hex');
    const revokedKey = await prisma.apiKey.create({
      data: {
        userId: operator.id,
        name: 'revoked-key',
        keyPrefix: 'ghc_usr_',
        keyHash: hash,
        status: 'revoked',
        revokedAt: new Date(),
      },
    });

    const result = await rotateOwnKeyAction(formDataFor(revokedKey.id));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_active');
  });

  it('refuses with rate_limited when called twice within 24h', async () => {
    const firstKey = await makeActiveKey('cooldown-1');
    const first = await rotateOwnKeyAction(formDataFor(firstKey.id));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // The just-created pending row can't be rotated (it's pending), so
    // we need a second ACTIVE key to even try. Create one and try
    // again — the cooldown should fire from the audit log of the first
    // rotation.
    const secondKey = await makeActiveKey('cooldown-2');
    const second = await rotateOwnKeyAction(formDataFor(secondKey.id));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('rate_limited');
  });

  it('refuses with invalid for non-numeric keyId', async () => {
    const fd = new FormData();
    fd.set('keyId', 'not-a-number');
    const result = await rotateOwnKeyAction(fd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid');
  });
});
