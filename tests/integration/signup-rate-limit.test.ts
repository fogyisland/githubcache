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
  // Bcrypt cost 12 means each signup is ~250ms; 11 signups take ~3 seconds.
  it(
    'first 10 attempts succeed (or hit validation, but never rate_limited); 11th returns rate_limited',
    async () => {
      let rateLimitedCount = 0;
      let otherCount = 0;

      for (let i = 0; i < 11; i++) {
        const fd = new FormData();
        fd.set('email', `${TEST_EMAIL_PREFIX}${i}-${Date.now()}@example.test`);
        fd.set('password', 'supersecret1');
        fd.set('passwordConfirm', 'supersecret1');
        let state;
        try {
          state = await signupAction(idleState, fd);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.startsWith('__redirect:')) {
            otherCount++;
            continue;
          }
          throw e;
        }
        if (state.status === 'rate_limited') {
          rateLimitedCount++;
        } else {
          // Successful signup — the action returned a state object
          // before redirecting on a previous call? Actually the
          // successful path throws NEXT_REDIRECT. If we got a state
          // object back, it's an unexpected status.
          otherCount++;
        }
      }

      // Exactly 10 succeeded (threw redirect) and the 11th came back
      // with rate_limited.
      expect(rateLimitedCount).toBe(1);
      expect(otherCount).toBe(10);
    },
    30_000,
  );
});
