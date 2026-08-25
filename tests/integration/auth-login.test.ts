import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { __resetAllLoginThrottlesForTests } from '@/lib/rate-limit/login-throttle';

const TEST_EMAIL_PREFIX = 'login-test-';

let activeUserId: bigint;
let activeUserPlainPassword: string;
let disabledUserId: bigint;
let activeUserEmail: string;
let disabledUserEmail: string;

beforeAll(async () => {
  // Create active user with bcrypt password
  activeUserPlainPassword = 'correct-horse-battery-staple';
  const u1 = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}active-${Date.now()}@example.test`,
      role: 'admin',
      status: 'active',
      passwordHash: await hashPassword(activeUserPlainPassword),
    },
  });
  activeUserId = u1.id;
  activeUserEmail = u1.email;

  // Create disabled user
  const u2 = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}disabled-${Date.now()}@example.test`,
      role: 'admin',
      status: 'disabled',
      passwordHash: await hashPassword(activeUserPlainPassword),
    },
  });
  disabledUserId = u2.id;
  disabledUserEmail = u2.email;
});

afterAll(async () => {
  // Delete sessions for our test users, then audit logs, then users
  const ids = [activeUserId, disabledUserId];
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: ids } },
        { targetId: { in: ids.map((id) => String(id)) } },
        { targetId: { startsWith: TEST_EMAIL_PREFIX } },
      ],
    },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Reset throttles + per-test cleanup
  __resetAllLoginThrottlesForTests();
  await prisma.session.deleteMany({ where: { userId: activeUserId } });
  // Reset lastLoginAt so tests that depend on it being null behave deterministically
  await prisma.user.update({
    where: { id: activeUserId },
    data: { lastLoginAt: null },
  });
});

// Helper to get CSRF + login in one shot, with optional IP override
async function loginRequest(opts: {
  email?: string;
  password?: string;
  ip?: string;
  csrfMissing?: boolean;
}): Promise<{ csrfRes: Response; loginRes: Response; cookies: string[] }> {
  // Step 1: GET /csrf to get token + cookie
  const csrfRes = await getCsrf();
  const csrfBody = (await csrfRes.json()) as { csrfToken: string };
  const csrfSetCookie = csrfRes.headers.get('Set-Cookie') ?? '';

  // Step 2: POST /login with email, password, csrf
  const headers = new Headers({
    'content-type': 'application/json',
    cookie: csrfSetCookie.split(';')[0] ?? '', // extract just the cookie name=value
    'x-csrf-token': opts.csrfMissing ? '' : csrfBody.csrfToken,
  });
  if (opts.ip) headers.set('x-forwarded-for', opts.ip);
  const loginRes = await postLogin(
    new Request('http://x/api/admin/auth/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: opts.email ?? activeUserEmail,
        password: opts.password ?? activeUserPlainPassword,
        csrf: csrfBody.csrfToken,
      }),
    }),
  );
  return { csrfRes, loginRes, cookies: [csrfSetCookie] };
}

describe('GET /api/admin/auth/csrf', () => {
  it('issues a token and sets the cookie', async () => {
    const res = await getCsrf();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { csrfToken: string };
    expect(body.csrfToken).toHaveLength(64);
    expect(body.csrfToken).toMatch(/^[0-9a-f]+$/);
    const setCookie = res.headers.get('Set-Cookie')!;
    expect(setCookie).toContain('ghc_csrf=');
    expect(setCookie).not.toContain('HttpOnly'); // MUST be JS-readable
  });

  it('issues different tokens on each call', async () => {
    const a = ((await (await getCsrf()).json()) as { csrfToken: string }).csrfToken;
    const b = ((await (await getCsrf()).json()) as { csrfToken: string }).csrfToken;
    expect(a).not.toBe(b);
  });
});

describe('POST /api/admin/auth/login', () => {
  it('logs in successfully with correct credentials, sets session + CSRF cookies', async () => {
    const { loginRes } = await loginRequest({});
    expect(loginRes.status).toBe(200);
    const body = (await loginRes.json()) as { ok: boolean; role: string };
    expect(body.ok).toBe(true);
    expect(body.role).toBe('admin');

    const setCookies =
      loginRes.headers.getSetCookie?.() ?? [loginRes.headers.get('Set-Cookie') ?? ''];
    const cookieStr = setCookies.join(' ');
    expect(cookieStr).toContain('ghc_admin_sid=');
    expect(cookieStr).toContain('HttpOnly');
    expect(cookieStr).toContain('ghc_csrf=');

    // Session row was created
    const sessions = await prisma.session.findMany({ where: { userId: activeUserId } });
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.userId).toBe(activeUserId);
  }, 15_000); // bcrypt slow

  it('returns 401 for wrong password (no email enumeration)', async () => {
    const { loginRes } = await loginRequest({ password: 'wrong-password' });
    expect(loginRes.status).toBe(401);
    const body = (await loginRes.json()) as { error: string };
    expect(body.error).toBe('invalid_credentials');
  }, 15_000);

  it('returns 401 for unknown email (same generic error)', async () => {
    const { loginRes } = await loginRequest({ email: 'nobody@example.com' });
    expect(loginRes.status).toBe(401);
    const body = (await loginRes.json()) as { error: string };
    expect(body.error).toBe('invalid_credentials');
  }, 15_000);

  it('returns 403 for disabled user with valid password', async () => {
    const { loginRes } = await loginRequest({ email: disabledUserEmail });
    expect(loginRes.status).toBe(403);
    const body = (await loginRes.json()) as { error: string };
    expect(body.error).toBe('account_disabled');
  }, 15_000);

  it('returns 403 for missing/invalid CSRF token', async () => {
    const { loginRes } = await loginRequest({ csrfMissing: true });
    expect(loginRes.status).toBe(403);
    const body = (await loginRes.json()) as { error: string };
    expect(body.error).toBe('csrf');
  });

  it('returns 400 for invalid body (missing email)', async () => {
    const csrfRes = await getCsrf();
    const csrfBody = (await csrfRes.json()) as { csrfToken: string };
    const csrfSetCookie = csrfRes.headers.get('Set-Cookie') ?? '';
    const headers = new Headers({
      'content-type': 'application/json',
      cookie: csrfSetCookie.split(';')[0] ?? '',
      'x-csrf-token': csrfBody.csrfToken,
    });
    const loginRes = await postLogin(
      new Request('http://x/api/admin/auth/login', {
        method: 'POST',
        headers,
        body: JSON.stringify({ password: 'x', csrf: csrfBody.csrfToken }),
      }),
    );
    expect(loginRes.status).toBe(400);
  });

  it('returns 429 after 5 failed attempts from same IP', async () => {
    const ip = '203.0.113.7';
    // Make 5 wrong-password attempts
    for (let i = 0; i < 5; i++) {
      const { loginRes } = await loginRequest({ password: 'wrong', ip });
      expect(loginRes.status).toBe(401);
    }
    // 6th attempt should be throttled
    const { loginRes } = await loginRequest({ password: 'wrong', ip });
    expect(loginRes.status).toBe(429);
    const body = (await loginRes.json()) as { error: string };
    expect(body.error).toBe('too_many_attempts');
    const retryAfter = loginRes.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  }, 30_000); // 5 bcrypt verifies ~5 * 250ms

  it('throttle does not block successful login from different IP', async () => {
    const blockedIp = '203.0.113.99';
    const okIp = '198.51.100.42';
    // Burn the blocked IP's throttle
    for (let i = 0; i < 5; i++) {
      await loginRequest({ password: 'wrong', ip: blockedIp });
    }
    // Try a successful login from a different IP
    const { loginRes } = await loginRequest({ ip: okIp });
    expect(loginRes.status).toBe(200);
  }, 30_000);

  it('updates user.lastLoginAt on success', async () => {
    const before = await prisma.user.findUnique({ where: { id: activeUserId } });
    expect(before?.lastLoginAt).toBeNull();
    await loginRequest({});
    const after = await prisma.user.findUnique({ where: { id: activeUserId } });
    expect(after?.lastLoginAt).not.toBeNull();
  }, 15_000);

  it('writes audit_log entries', async () => {
    // Successful login should write `login_success`
    await loginRequest({});
    await new Promise((resolve) => setTimeout(resolve, 100));
    const successes = await prisma.auditLog.findMany({
      where: { action: 'login_success', targetId: String(activeUserId) },
    });
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // Failed login should write `login_failed`
    await loginRequest({ password: 'wrong' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const failures = await prisma.auditLog.findMany({
      where: { action: 'login_failed', targetId: String(activeUserId) },
    });
    expect(failures.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
