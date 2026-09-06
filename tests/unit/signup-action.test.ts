import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import { prisma } from '@/lib/db/client';

// Mock next/headers BEFORE the action module loads.
const headerState = {
  xff: '198.51.100.10' as string | null,
  host: 'cache.test' as string | null,
  origin: null as string | null,
  proto: null as string | null,
};

vi.mock('next/headers', () => ({
  headers: () => ({
    get(name: string): string | null {
      const n = name.toLowerCase();
      if (n === 'x-forwarded-for') return headerState.xff;
      if (n === 'host') return headerState.host;
      if (n === 'origin') return headerState.origin;
      if (n === 'x-forwarded-proto') return headerState.proto;
      return null;
    },
  }),
  cookies: () => {
    // Map-backed fake. Tests don't set cookies through here, but
    // signupAction calls `cookies()` to forward the new session cookie.
    const m = new Map<string, { name: string; value: string }>();
    return {
      getAll: () => Array.from(m.values()).map((v) => ({ name: v.name, value: v.value })),
      get: (name: string) => m.get(name),
      set: (opts: { name: string; value: string }) => {
        m.set(opts.name, opts);
      },
    };
  },
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`__redirect:${url}`);
  },
}));

const sendWelcomeMock = vi.fn();
vi.mock('@/lib/email/triggers/signup-welcome', () => ({
  sendSignupWelcomeEmail: (...args: unknown[]) => sendWelcomeMock(...args),
}));

import { signupAction } from '@/app/signup/_actions/signup';

const TEST_EMAIL_PREFIX = 'signup-action-test-';
const idleState = { status: 'idle' as const };

function formDataFor(input: {
  email?: string;
  password?: string;
  passwordConfirm?: string;
  name?: string;
}): FormData {
  const fd = new FormData();
  fd.set('email', input.email ?? 'user@example.test');
  fd.set('password', input.password ?? 'supersecret1');
  fd.set('passwordConfirm', input.passwordConfirm ?? input.password ?? 'supersecret1');
  if (input.name !== undefined) fd.set('name', input.name);
  return fd;
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { action: 'user_signed_up' },
  });
  await prisma.session.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

// Local cleanup helper: sessions point at users, so we must delete
// sessions before users in finally blocks.
async function cleanupUser(email: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { user: { email } },
  });
  await prisma.user.deleteMany({ where: { email } });
}

beforeEach(async () => {
  sendWelcomeMock.mockReset();
  sendWelcomeMock.mockResolvedValue({ ok: true, logId: 1n });
  headerState.xff = '198.51.100.10';
  headerState.host = 'cache.test';
  headerState.origin = null;
  headerState.proto = null;
  // Clean slate for rate-limit audit rows from this IP.
  await prisma.auditLog.deleteMany({
    where: { action: 'user_signed_up', ip: '198.51.100.10' },
  });
});

describe('signupAction', () => {
  it('rejects invalid email with status=invalid and fieldErrors.email', async () => {
    const state = await signupAction(idleState, formDataFor({ email: 'not-an-email' }));
    expect(state.status).toBe('invalid');
    expect(state.fieldErrors?.email).toBeDefined();
  });

  it('rejects too-short password', async () => {
    const state = await signupAction(
      idleState,
      formDataFor({ password: 'short', passwordConfirm: 'short' }),
    );
    expect(state.status).toBe('invalid');
    expect(state.fieldErrors?.password).toBeDefined();
  });

  it('rejects mismatched password + confirm', async () => {
    const state = await signupAction(
      idleState,
      formDataFor({ password: 'supersecret1', passwordConfirm: 'different11' }),
    );
    expect(state.status).toBe('invalid');
    expect(state.fieldErrors?.passwordConfirm).toBeDefined();
  });

  it('creates user with signupSource=self, role=operator, status=active, hashes password', async () => {
    const email = `${TEST_EMAIL_PREFIX}${Date.now()}@example.test`;
    try {
      await expect(
        signupAction(idleState, formDataFor({ email, name: 'Test User' })),
      ).rejects.toThrow(/__redirect:\/account/);

      const user = await prisma.user.findUnique({
        where: { email },
      });
      expect(user).not.toBeNull();
      expect(user!.role).toBe('operator');
      expect(user!.status).toBe('active');
      expect(user!.signupSource).toBe('self');
      expect(user!.passwordHash).toBeDefined();
      expect(user!.passwordHash).not.toBe('supersecret1');
      expect(user!.passwordHash!.length).toBeGreaterThan(20);
    } finally {
      await cleanupUser(email);
    }
  });

  it('writes user_signed_up audit row with targetId=new user id', async () => {
    const email = `${TEST_EMAIL_PREFIX}audit-${Date.now()}@example.test`;
    try {
      await expect(
        signupAction(idleState, formDataFor({ email })),
      ).rejects.toThrow(/__redirect/);

      const audits = await prisma.auditLog.findMany({
        where: { action: 'user_signed_up', ip: '198.51.100.10' },
      });
      const mine = audits.find((a) => a.metadata && (a.metadata as { email?: string }).email === email);
      expect(mine).toBeDefined();
      expect(mine!.targetType).toBe('user');
      expect(mine!.targetId).toBeTruthy();
    } finally {
      await prisma.auditLog.deleteMany({
        where: { action: 'user_signed_up', ip: '198.51.100.10' },
      });
      await cleanupUser(email);
    }
  });

  it('returns duplicate error when email already exists', async () => {
    const email = `${TEST_EMAIL_PREFIX}dup-${Date.now()}@example.test`;
    try {
      await expect(
        signupAction(idleState, formDataFor({ email })),
      ).rejects.toThrow(/__redirect/);
      // Second attempt with same email should NOT redirect and should
      // report duplicate.
      const state2 = await signupAction(idleState, formDataFor({ email }));
      expect(state2.status).toBe('duplicate');
      expect(state2.fieldErrors?.email).toBeDefined();
    } finally {
      await cleanupUser(email);
    }
  });

  it('triggers sendSignupWelcomeEmail after successful signup', async () => {
    const email = `${TEST_EMAIL_PREFIX}email-${Date.now()}@example.test`;
    try {
      await expect(
        signupAction(idleState, formDataFor({ email })),
      ).rejects.toThrow(/__redirect/);

      expect(sendWelcomeMock).toHaveBeenCalledTimes(1);
      const [args] = sendWelcomeMock.mock.calls[0]!;
      expect(args.user.email).toBe(email);
      expect(args.origin).toContain('http://cache.test');
    } finally {
      await cleanupUser(email);
    }
  });

  it('rate-limits when audit-log bucket reaches the configured ceiling', async () => {
    // Default ceiling is 50000/hour — impractical to insert that many
    // rows in a unit test. Use the SIGNUP_RATE_PER_HOUR env override
    // (consumed by `getSignupRateLimit`) to lower the threshold to 2,
    // then seed 2 audit rows and verify the next call is blocked.
    process.env['SIGNUP_RATE_PER_HOUR'] = '2';
    const ip = '198.51.100.99';
    headerState.xff = ip;
    try {
      await prisma.auditLog.deleteMany({
        where: { action: 'user_signed_up', ip },
      });
      await prisma.auditLog.createMany({
        data: [
          { action: 'user_signed_up', targetType: 'user', targetId: 'fake-0', ip, createdAt: new Date() },
          { action: 'user_signed_up', targetType: 'user', targetId: 'fake-1', ip, createdAt: new Date() },
        ],
      });

      const state = await signupAction(
        idleState,
        formDataFor({ email: `${TEST_EMAIL_PREFIX}rl-${Date.now()}@example.test` }),
      );
      expect(state.status).toBe('rate_limited');
    } finally {
      delete process.env['SIGNUP_RATE_PER_HOUR'];
      await prisma.auditLog.deleteMany({
        where: { action: 'user_signed_up', ip },
      });
    }
  });
});
