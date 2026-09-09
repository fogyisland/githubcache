import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/client';

const headerState = {
  xff: '198.51.100.42' as string | null,
  host: 'cache.test' as string | null,
};

vi.mock('next/headers', () => ({
  headers: () => ({
    get(name: string): string | null {
      const n = name.toLowerCase();
      if (n === 'x-forwarded-for') return headerState.xff;
      if (n === 'host') return headerState.host;
      return null;
    },
  }),
  cookies: () => ({
    getAll: () => [],
    get: () => undefined,
    set: () => undefined,
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`__redirect:${url}`);
  },
}));

const sendWelcomeMock = vi.fn();
vi.mock('@/lib/email/triggers/signup-welcome', () => ({
  sendSignupWelcomeEmail: () => sendWelcomeMock(),
}));

import { signupAction } from '@/app/signup/_actions/signup';
import { getSignupRateLimit } from '@/lib/auth/signup-rate';

const TEST_EMAIL_PREFIX = 'signup-rl-int-';
const idleState = { status: 'idle' as const };

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { action: 'user_signed_up', ip: '198.51.100.42' },
  });
  await prisma.session.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(async () => {
  sendWelcomeMock.mockReset();
  sendWelcomeMock.mockResolvedValue({ ok: true, logId: 1n });
  headerState.xff = '198.51.100.42';
  headerState.host = 'cache.test';
  await prisma.auditLog.deleteMany({
    where: { action: 'user_signed_up', ip: '198.51.100.42' },
  });
  await prisma.session.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
});

describe('signup rate limit', () => {
  it('exposes the default 50000/hour ceiling', () => {
    // No env override → default constant.
    delete process.env['SIGNUP_RATE_PER_HOUR'];
    expect(getSignupRateLimit()).toBe(50_000);
  });

  it('honours SIGNUP_RATE_PER_HOUR env override', () => {
    process.env['SIGNUP_RATE_PER_HOUR'] = '5';
    expect(getSignupRateLimit()).toBe(5);
    delete process.env['SIGNUP_RATE_PER_HOUR'];
  });

  // Mechanism test: override the limit to 3, then verify that the 4th
  // attempt (after the audit-log bucket already has 3 rows) returns
  // rate_limited. Inserting 50000+1 audit rows for the default would
  // be impractical; the env override is the production-tunable
  // surface and the test exercises the same code path.
  it(
    'returns rate_limited when audit-log bucket reaches the configured ceiling',
    async () => {
      process.env['SIGNUP_RATE_PER_HOUR'] = '3';
      try {
        const ip = '198.51.100.42';
        // Pre-seed 3 audit rows so the next call sees count === 3.
        await prisma.auditLog.createMany({
          data: Array.from({ length: 3 }, (_, i) => ({
            actorUserId: 0,
            action: 'user_signed_up',
            targetType: 'user',
            targetId: `seed-${i}`,
            ip,
            createdAt: new Date(),
          })),
        });

        const fd = new FormData();
        fd.set('email', `${TEST_EMAIL_PREFIX}over-${Date.now()}@example.test`);
        fd.set('password', 'supersecret1');
        fd.set('passwordConfirm', 'supersecret1');
        let state;
        try {
          state = await signupAction(idleState, fd);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`unexpected redirect: ${msg}`);
        }
        expect(state.status).toBe('rate_limited');
        expect(state.message).toMatch(/too many/i);
      } finally {
        delete process.env['SIGNUP_RATE_PER_HOUR'];
      }
    },
    15_000,
  );
});
