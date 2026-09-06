import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';
import { generateSessionId } from '@/lib/db/sessions';
import type { User } from '@prisma/client';

const TEST_EMAIL_PREFIX = 'account-keys-req-int-';
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

const sendKeyRequestedMock = vi.fn();
vi.mock('@/lib/email/triggers/key-requested', () => ({
  sendKeyRequestedEmail: (...args: unknown[]) => sendKeyRequestedMock(...args),
}));

vi.mock('@/lib/auth/session', () => ({
  validateSession: async () => ({
    id: operator?.id ?? 1n,
    email: TEST_EMAIL,
    role: 'operator',
    status: 'active',
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

import { requestKeyAction } from '@/app/account/keys/request/_actions/request';

beforeAll(async () => {
  operator = await prisma.user.create({
    data: {
      email: TEST_EMAIL,
      role: 'operator',
      status: 'active',
      passwordHash: await hashPassword('pw'),
      signupSource: 'self',
    },
  });
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
    where: { actorUserId: operator.id, action: 'request_key_self' },
  });
  await prisma.session.deleteMany({ where: { userId: operator.id } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  sendKeyRequestedMock.mockReset();
  sendKeyRequestedMock.mockResolvedValue({ sent: 1, failed: 0, results: [] });
  // Clean up any pending key left over from a previous test.
  await prisma.apiKey.deleteMany({ where: { userId: operator.id, status: 'pending' } });
});

const idleState = { status: 'idle' as const };

function formDataFor(input: { name?: string; description?: string }): FormData {
  const fd = new FormData();
  fd.set('name', input.name ?? 'my-pipeline-key');
  if (input.description !== undefined) fd.set('description', input.description);
  return fd;
}

describe('requestKeyAction', () => {
  it('creates a pending ApiKey row with sha256 hash and 64-char hash', async () => {
    await expect(
      requestKeyAction(idleState, formDataFor({ description: 'Used by CI' })),
    ).rejects.toThrow(/__redirect/);

    const rows = await prisma.apiKey.findMany({
      where: { userId: operator.id, status: 'pending' },
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.name).toBe('my-pipeline-key');
    expect(rows[0]!.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.keyPrefix.startsWith('ghc_usr_')).toBe(true);
  });

  it('writes request_key_self audit row', async () => {
    await prisma.auditLog.deleteMany({
      where: { actorUserId: operator.id, action: 'request_key_self' },
    });
    await expect(
      requestKeyAction(idleState, formDataFor({ name: 'audit-key-1' })),
    ).rejects.toThrow(/__redirect/);

    const audits = await prisma.auditLog.findMany({
      where: { actorUserId: operator.id, action: 'request_key_self' },
    });
    expect(audits.length).toBeGreaterThan(0);
    const latest = audits[audits.length - 1]!;
    expect(latest.targetType).toBe('api_key');
    expect(latest.targetId).toBeTruthy();
  });

  it('triggers sendKeyRequestedEmail', async () => {
    await expect(
      requestKeyAction(idleState, formDataFor({ name: 'email-test-key' })),
    ).rejects.toThrow(/__redirect/);

    expect(sendKeyRequestedMock).toHaveBeenCalledTimes(1);
    const args = sendKeyRequestedMock.mock.calls[0]![0] as {
      apiKey: { name: string };
      requester: { email: string };
      origin: string;
    };
    expect(args.apiKey.name).toBe('email-test-key');
    expect(args.requester.email).toBe(TEST_EMAIL);
    expect(args.origin).toContain('http://cache.test');
  });

  it('rejects blank name with status=invalid', async () => {
    const state = await requestKeyAction(idleState, formDataFor({ name: '' }));
    expect(state.status).toBe('invalid');
    expect(state.fieldErrors?.name).toBeDefined();
  });

  it('blocks stacking pending requests', async () => {
    await expect(
      requestKeyAction(idleState, formDataFor({ name: 'first-key' })),
    ).rejects.toThrow(/__redirect/);
    const state = await requestKeyAction(idleState, formDataFor({ name: 'second-attempt' }));
    expect(state.status).toBe('invalid');
    expect(state.fieldErrors?.name).toMatch(/already have a pending/i);
  });
});
