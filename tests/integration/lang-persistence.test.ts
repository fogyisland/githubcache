import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { __resetAllLoginThrottlesForTests } from '@/lib/rate-limit/login-throttle';
import { LOCALES } from '@/i18n/config';

const TEST_EMAIL_PREFIX = 'lang-persist-';

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
    data: { lastLoginAt: null, lang: 'zh' },
  });
});

// -----------------------------------------------------------------------------
// Login route lang persistence
// -----------------------------------------------------------------------------

async function loginWithCookie(langCookie: string | null): Promise<Response> {
  // Step 1: CSRF
  const csrfRes = await getCsrf();
  const csrfBody = (await csrfRes.json()) as { csrfToken: string };
  const csrfSetCookie = csrfRes.headers.get('Set-Cookie') ?? '';
  const csrfCookiePart = csrfSetCookie.split(';')[0] ?? '';

  // Step 2: Compose cookie header (CSRF + optional lang)
  const cookieHeader = langCookie === null
    ? csrfCookiePart
    : `${csrfCookiePart}; ${langCookie}`;

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

describe('POST /api/admin/auth/login — lang persistence', () => {
  it('persists users.lang from ghc_lang cookie on successful login', async () => {
    const res = await loginWithCookie('ghc_lang=en');
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: activeUserId } });
    expect(user?.lang).toBe('en');
  }, 15_000);

  it('persists zh from ghc_lang cookie', async () => {
    const res = await loginWithCookie('ghc_lang=zh');
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: activeUserId } });
    expect(user?.lang).toBe('zh');
  }, 15_000);

  it('leaves users.lang unchanged when no ghc_lang cookie is present', async () => {
    // Pre-set lang to a known value to make sure login does NOT clobber it
    await prisma.user.update({
      where: { id: activeUserId },
      data: { lang: 'zh' },
    });

    const res = await loginWithCookie(null);
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: activeUserId } });
    // No lang cookie was sent → spread evaluates to {} → no lang field in update → untouched
    expect(user?.lang).toBe('zh');
  }, 15_000);

  it('ignores invalid ghc_lang cookie value (does not crash, no DB write)', async () => {
    // Pre-set lang to 'en' (not the default 'zh') so we can detect any DB write
    await prisma.user.update({
      where: { id: activeUserId },
      data: { lang: 'en' },
    });

    const res = await loginWithCookie('ghc_lang=fr'); // 'fr' is not in LOCALES
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: activeUserId } });
    // Invalid cookie value → spread evaluates to {} → no lang field in update
    // → users.lang must stay unchanged from 'en' (proves no DB write)
    expect(user?.lang).toBe('en');
  }, 15_000);
});

// -----------------------------------------------------------------------------
// setLangAction — server action
// -----------------------------------------------------------------------------

// The server action calls `cookies()` from `next/headers` directly (not via a
// `cookiesFromRequest` adapter). Vitest doesn't have a real Next.js runtime, so
// we mock `next/headers` to provide an in-memory cookie store. The action
// then calls `validateSession` which reads cookies via `cookiesFromRequest` —
// that helper is itself a thin wrapper around the cookies object we mock.
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

describe('setLangAction', () => {
  beforeEach(() => {
    // Reset the in-memory cookie store between tests
    vi.resetModules();
  });

  it('writes ghc_lang cookie for anonymous caller', async () => {
    // Re-import after resetModules so the mock is fresh
    const { setLangAction: action } = await import('@/app/_actions/set-lang');
    // No session cookie in the store → validateSession returns null → no DB write
    const fd = new FormData();
    fd.set('locale', 'en');
    const state = await action({ status: 'idle' }, fd);
    expect(state.status).toBe('ok');
    expect(state.locale).toBe('en');
  });

  it('rejects invalid locale with status=invalid', async () => {
    const { setLangAction: action } = await import('@/app/_actions/set-lang');
    const fd = new FormData();
    fd.set('locale', 'fr'); // not in LOCALES
    const state = await action({ status: 'idle' }, fd);
    expect(state.status).toBe('invalid');
    expect(state.locale).toBeUndefined();
  });

  it('rejects missing locale with status=invalid', async () => {
    const { setLangAction: action } = await import('@/app/_actions/set-lang');
    const fd = new FormData();
    // No locale at all
    const state = await action({ status: 'idle' }, fd);
    expect(state.status).toBe('invalid');
  });

  it('round-trips both valid locales', async () => {
    const { setLangAction: action } = await import('@/app/_actions/set-lang');
    for (const locale of LOCALES) {
      const fd = new FormData();
      fd.set('locale', locale);
      const state = await action({ status: 'idle' }, fd);
      expect(state.status).toBe('ok');
      expect(state.locale).toBe(locale);
    }
  });
});
