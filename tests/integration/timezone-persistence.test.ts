import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { __resetAllLoginThrottlesForTests } from '@/lib/rate-limit/login-throttle';
import { TIMEZONE_IDS } from '@/lib/timezone/registry';

const TEST_EMAIL_PREFIX = 'tz-persist-';

let activeUserId: bigint;
let activeUserPlainPassword: string;
let activeUserEmail: string;

beforeAll(async () => {
  activeUserPlainPassword = 'correct-horse-battery-staple';
  const u = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}active-${Date.now()}@example.test`,
      role: 'admin',
      status: 'active',
      passwordHash: await hashPassword(activeUserPlainPassword),
      timezone: null, // start with no explicit preference
    },
  });
  activeUserId = u.id;
  activeUserEmail = u.email;
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: activeUserId } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: activeUserId },
        { targetId: String(activeUserId) },
        { targetId: { startsWith: TEST_EMAIL_PREFIX } },
      ],
    },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  __resetAllLoginThrottlesForTests();
  await prisma.session.deleteMany({ where: { userId: activeUserId } });
  await prisma.user.update({
    where: { id: activeUserId },
    data: { lastLoginAt: null, timezone: null },
  });
});

// -----------------------------------------------------------------------------
// Login route timezone persistence (mirrors lang-persistence.test.ts)
// -----------------------------------------------------------------------------

async function loginWithCookie(tzCookie: string | null): Promise<Response> {
  const csrfRes = await getCsrf();
  const csrfBody = (await csrfRes.json()) as { csrfToken: string };
  const csrfSetCookie = csrfRes.headers.get('Set-Cookie') ?? '';
  const csrfCookiePart = csrfSetCookie.split(';')[0] ?? '';

  const cookieHeader = tzCookie === null
    ? csrfCookiePart
    : `${csrfCookiePart}; ${tzCookie}`;

  const headers = new Headers({
    'content-type': 'application/json',
    cookie: cookieHeader,
    'x-csrf-token': csrfBody.csrfToken,
    'x-forwarded-for': '203.0.113.10',
  });

  return postLogin(
    new Request('http://x/api/admin/auth/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: activeUserEmail,
        password: activeUserPlainPassword,
        csrf: csrfBody.csrfToken,
      }),
    }),
  );
}

describe('POST /api/admin/auth/login — timezone persistence', () => {
  it('persists users.timezone from ghc_tz cookie on successful login', async () => {
    const res = await loginWithCookie('ghc_tz=America/Los_Angeles');
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: activeUserId } });
    expect(user?.timezone).toBe('America/Los_Angeles');
  }, 15_000);

  it('persists Asia/Shanghai from ghc_tz cookie', async () => {
    const res = await loginWithCookie('ghc_tz=Asia/Shanghai');
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: activeUserId } });
    expect(user?.timezone).toBe('Asia/Shanghai');
  }, 15_000);

  it('leaves users.timezone unchanged when no ghc_tz cookie is present', async () => {
    await prisma.user.update({
      where: { id: activeUserId },
      data: { timezone: 'Europe/Paris' },
    });

    const res = await loginWithCookie(null);
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: activeUserId } });
    expect(user?.timezone).toBe('Europe/Paris');
  }, 15_000);

  it('ignores invalid ghc_tz cookie value (does not crash, no DB write)', async () => {
    await prisma.user.update({
      where: { id: activeUserId },
      data: { timezone: 'Asia/Tokyo' },
    });

    const res = await loginWithCookie('ghc_tz=Africa/Johannesburg'); // not in allowlist
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: activeUserId } });
    expect(user?.timezone).toBe('Asia/Tokyo');
  }, 15_000);
});

// -----------------------------------------------------------------------------
// setTimezoneAction — server action (mirrors setLangAction tests)
// -----------------------------------------------------------------------------

vi.mock('next/headers', () => {
  type CookieMap = Map<string, { value: string }>;
  const store: CookieMap = new Map();
  return {
    cookies: () => ({
      get: (name: string) => store.get(name),
      getAll: () => Array.from(store.entries()).map(([name, v]) => ({ name, value: v.value })),
      set: (opts: { name: string; value: string }) => {
        store.set(opts.name, { value: opts.value });
      },
      delete: (name: string) => {
        store.delete(name);
      },
    }),
  };
});
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('setTimezoneAction', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('writes ghc_tz cookie for anonymous caller', async () => {
    const { setTimezoneAction: action } = await import('@/app/_actions/set-timezone');
    const fd = new FormData();
    fd.set('timezone', 'Europe/Paris');
    const state = await action({ status: 'idle' }, fd);
    expect(state.status).toBe('ok');
    expect(state.timezone).toBe('Europe/Paris');
  });

  it('rejects invalid timezone with status=invalid', async () => {
    const { setTimezoneAction: action } = await import('@/app/_actions/set-timezone');
    const fd = new FormData();
    fd.set('timezone', 'Africa/Johannesburg'); // not in TIMEZONE_IDS
    const state = await action({ status: 'idle' }, fd);
    expect(state.status).toBe('invalid');
    expect(state.timezone).toBeUndefined();
  });

  it('rejects missing timezone with status=invalid', async () => {
    const { setTimezoneAction: action } = await import('@/app/_actions/set-timezone');
    const fd = new FormData();
    const state = await action({ status: 'idle' }, fd);
    expect(state.status).toBe('invalid');
  });

  it('round-trips every curated timezone id', async () => {
    const { setTimezoneAction: action } = await import('@/app/_actions/set-timezone');
    for (const tz of TIMEZONE_IDS) {
      const fd = new FormData();
      fd.set('timezone', tz);
      const state = await action({ status: 'idle' }, fd);
      expect(state.status).toBe('ok');
      expect(state.timezone).toBe(tz);
    }
  });

  it('persists users.timezone when session cookie is present', async () => {
    // Seed a session cookie so validateSession picks up our test user.
    // Note: the actual cookie name is `ghc_admin_sid` (see SESSION_COOKIE_NAME
    // in src/lib/auth/session.ts), not `ghc_session`.
    const { cookies } = await import('next/headers');
    const sessionId = 'tz-test-session-' + Date.now();
    await prisma.session.create({
      data: {
        id: sessionId,
        userId: activeUserId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    // Mock cookie store must include the session cookie for validateSession to find it
    cookies().set({ name: 'ghc_admin_sid', value: sessionId });

    const { setTimezoneAction: action } = await import('@/app/_actions/set-timezone');
    const fd = new FormData();
    fd.set('timezone', 'America/Chicago');
    const state = await action({ status: 'idle' }, fd);
    expect(state.status).toBe('ok');

    const user = await prisma.user.findUnique({ where: { id: activeUserId } });
    expect(user?.timezone).toBe('America/Chicago');
  });
});
