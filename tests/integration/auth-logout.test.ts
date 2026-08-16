import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { POST as postLogout } from '@/app/api/admin/auth/logout/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { __resetAllLoginThrottlesForTests } from '@/lib/rate-limit/login-throttle';

const TEST_EMAIL_PREFIX = 'logout-test-';
let testUserId: bigint;
let testUserEmail: string;
const TEST_PASSWORD = 'logout-test-password';

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}u-${Date.now()}@example.test`,
      role: 'admin',
      status: 'active',
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });
  testUserId = u.id;
  testUserEmail = u.email;
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: testUserId } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ targetId: String(testUserId) }, { actorUserId: testUserId }],
    },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  __resetAllLoginThrottlesForTests();
  await prisma.session.deleteMany({ where: { userId: testUserId } });
});

// Helper: log in a user, return the session cookie value
async function loginAndGetCookies(): Promise<{ sessionCookie: string; csrfCookie: string }> {
  const csrfRes = await getCsrf();
  const csrfBody = (await csrfRes.json()) as { csrfToken: string };
  const csrfCookie = (csrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  const headers = new Headers({
    'content-type': 'application/json',
    cookie: csrfCookie,
    'x-csrf-token': csrfBody.csrfToken,
  });
  const loginRes = await postLogin(
    new Request('http://x/api/admin/auth/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: testUserEmail,
        password: TEST_PASSWORD,
        csrf: csrfBody.csrfToken,
      }),
    }),
  );
  expect(loginRes.status).toBe(200);
  // Get session cookie from Set-Cookie header
  const allSetCookies = loginRes.headers.getSetCookie?.() ?? [];
  const sessionCookieLine = allSetCookies.find((c) => c.startsWith('ghc_admin_sid='));
  return {
    sessionCookie: sessionCookieLine?.split(';')[0] ?? '',
    csrfCookie,
  };
}

describe('POST /api/admin/auth/logout', () => {
  it('clears session cookie, CSRF cookie, and DB session row', async () => {
    const { sessionCookie } = await loginAndGetCookies();
    // Confirm session row exists
    const sessionsBefore = await prisma.session.findMany({ where: { userId: testUserId } });
    expect(sessionsBefore.length).toBe(1);

    // Logout
    const logoutRes = await postLogout(
      new Request('http://x/api/admin/auth/logout', {
        method: 'POST',
        headers: { cookie: sessionCookie },
      }),
    );
    expect(logoutRes.status).toBe(200);
    const body = (await logoutRes.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Set-Cookie headers should clear both cookies
    const setCookies =
      logoutRes.headers.getSetCookie?.() ?? [logoutRes.headers.get('Set-Cookie') ?? ''];
    const cookieStr = setCookies.join(' ');
    expect(cookieStr).toContain('ghc_admin_sid=');
    expect(cookieStr).toContain('Max-Age=0');
    expect(cookieStr).toContain('ghc_csrf=');

    // Session row was deleted
    const sessionsAfter = await prisma.session.findMany({ where: { userId: testUserId } });
    expect(sessionsAfter.length).toBe(0);
  }, 15_000);

  it('returns 200 even with no session cookie (idempotent)', async () => {
    const logoutRes = await postLogout(
      new Request('http://x/api/admin/auth/logout', { method: 'POST' }),
    );
    expect(logoutRes.status).toBe(200);
    const body = (await logoutRes.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 200 even with invalid session cookie', async () => {
    const logoutRes = await postLogout(
      new Request('http://x/api/admin/auth/logout', {
        method: 'POST',
        headers: { cookie: 'ghc_admin_sid=garbage-not-a-real-session-id' },
      }),
    );
    expect(logoutRes.status).toBe(200);
  });

  it('does not leak other sessions on logout (only deletes own)', async () => {
    // Create a second session manually for the same user
    const { sessionCookie } = await loginAndGetCookies();
    // Now login again to create a second session
    await loginAndGetCookies();
    const sessionsBefore = await prisma.session.findMany({ where: { userId: testUserId } });
    expect(sessionsBefore.length).toBe(2);

    // Logout — should only clear the session whose cookie was sent
    const logoutRes = await postLogout(
      new Request('http://x/api/admin/auth/logout', {
        method: 'POST',
        headers: { cookie: sessionCookie },
      }),
    );
    expect(logoutRes.status).toBe(200);

    const sessionsAfter = await prisma.session.findMany({ where: { userId: testUserId } });
    expect(sessionsAfter.length).toBe(1); // one remains (the second login's)
  }, 30_000);
});
