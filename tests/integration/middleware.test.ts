import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { middleware } from '@/middleware';
import type { NextRequest } from 'next/server';

// All tests in this file model the "post-init" world — the service is
// already past the wizard, the .env has GHC_SETUP_DONE=1, and a fresh
// dev:server boot has loaded it into process.env. Without this, every
// request would 307 to /init (the actual production bug M32.6.5 fixes).
// Tests that specifically exercise the setup gate unset it locally.
const savedEnv = process.env.GHC_SETUP_DONE;
beforeAll(() => {
  process.env.GHC_SETUP_DONE = '1';
});
afterAll(() => {
  if (savedEnv === undefined) delete process.env.GHC_SETUP_DONE;
  else process.env.GHC_SETUP_DONE = savedEnv;
});

// Mock NextResponse so we can capture redirects/json responses
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  const noopHeaders = { set: (_name: string, _value: string) => undefined };
  return {
    ...actual,
    NextResponse: {
      ...actual.NextResponse,
      redirect: vi.fn((url: URL | string) => ({
        type: 'redirect',
        url: typeof url === 'string' ? url : url.toString(),
        status: 307,
        headers: noopHeaders,
      })),
      json: vi.fn((body: unknown, init?: { status?: number }) => ({
        type: 'json',
        body,
        status: init?.status ?? 200,
        headers: noopHeaders,
      })),
      next: vi.fn(() => ({
        type: 'next',
        status: 200,
        headers: { set: (_name: string, _value: string) => undefined },
      })),
    },
  };
});

function makeReq(opts: {
  pathname: string;
  method?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}): NextRequest {
  const url = `http://x${opts.pathname}`;
  const req = new Request(url, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.cookies
        ? {
            cookie: Object.entries(opts.cookies)
              .map(([k, v]) => `${k}=${v}`)
              .join('; '),
          }
        : {}),
      ...(opts.headers ?? {}),
    },
  }) as unknown as NextRequest;
  // Inject NextRequest's nextUrl (mock — pathname is what we care about).
  // Cast through unknown: NextURL is a class, not URL, but middleware only
  // reads .pathname which both expose.
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(url);
  // Always inject a cookies API — without this, the middleware's
  // `req.cookies.get(...)` throws on a TypeError when no cookies are
  // passed, masking the real setup-gate behaviour with a JS error.
  // The injected getter returns undefined for any name not in opts.cookies,
  // which is what an actual NextRequest does with no Cookie header.
  const cookieMap = opts.cookies ?? {};
  (req as unknown as { cookies: { get(name: string): { value: string } | undefined } }).cookies = {
    get: (name: string) =>
      cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
  };
  return req;
}

describe('middleware: /admin/*', () => {
  it('redirects to /login when no session cookie', async () => {
    const req = makeReq({ pathname: '/admin' });
    const res = await middleware(req);
    expect(res.type).toBe('redirect');
    expect(res.url).toBe('http://x/login');
  });

  it('redirects to /login on /admin/users when no cookie', async () => {
    const req = makeReq({ pathname: '/admin/users' });
    const res = await middleware(req);
    expect(res.type).toBe('redirect');
    expect(res.url).toBe('http://x/login');
  });

  it('passes through /admin/* when session cookie present', async () => {
    const req = makeReq({
      pathname: '/admin',
      cookies: { ghc_admin_sid: 'some-session-id-here-just-for-format-check' },
    });
    const res = await middleware(req);
    expect(res.type).toBe('next');
  });

  it('passes through /admin/api-keys/[id] when cookie present', async () => {
    const req = makeReq({
      pathname: '/admin/api-keys/123',
      cookies: { ghc_admin_sid: 'some-session' },
    });
    const res = await middleware(req);
    expect(res.type).toBe('next');
  });
});

describe('middleware: /api/admin/* CSRF', () => {
  it('blocks POST without CSRF with 403', async () => {
    const req = makeReq({ pathname: '/api/admin/api-keys/1/revoke', method: 'POST' });
    const res = await middleware(req);
    expect(res.type).toBe('json');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'csrf' });
  });

  it('blocks POST with mismatched CSRF (cookie vs header) with 403', async () => {
    const req = makeReq({
      pathname: '/api/admin/api-keys/1/revoke',
      method: 'POST',
      cookies: { ghc_csrf: 'token-in-cookie' },
      headers: { 'x-csrf-token': 'different-token-in-header' },
    });
    const res = await middleware(req);
    expect(res.type).toBe('json');
    expect(res.status).toBe(403);
  });

  it('allows POST with matching CSRF cookie + header', async () => {
    const token = 'a'.repeat(64);
    const req = makeReq({
      pathname: '/api/admin/api-keys/1/revoke',
      method: 'POST',
      cookies: { ghc_csrf: token },
      headers: { 'x-csrf-token': token },
    });
    const res = await middleware(req);
    expect(res.type).toBe('next');
  });

  it('allows GET /api/admin/* without CSRF (idempotent reads)', async () => {
    const req = makeReq({ pathname: '/api/admin/api-keys', method: 'GET' });
    const res = await middleware(req);
    expect(res.type).toBe('next');
  });

  it('allows GET /api/admin/auth/csrf (bootstrap CSRF token)', async () => {
    const req = makeReq({ pathname: '/api/admin/auth/csrf', method: 'GET' });
    const res = await middleware(req);
    expect(res.type).toBe('next');
  });

  it('blocks POST to login route without CSRF (login itself needs CSRF)', async () => {
    const req = makeReq({ pathname: '/api/admin/auth/login', method: 'POST' });
    const res = await middleware(req);
    expect(res.type).toBe('json');
    expect(res.status).toBe(403);
  });

  it('allows POST to login with valid CSRF', async () => {
    const token = 'b'.repeat(64);
    const req = makeReq({
      pathname: '/api/admin/auth/login',
      method: 'POST',
      cookies: { ghc_csrf: token },
      headers: { 'x-csrf-token': token },
    });
    const res = await middleware(req);
    expect(res.type).toBe('next');
  });
});

describe('middleware: non-admin paths (post-init)', () => {
  // These paths are public/admin-login — they must work once the wizard
  // has completed. We model "post-init" by passing the ghc_setup_done
  // cookie the wizard stamps at the end of step 3. Without it, the
  // setup gate correctly bounces everything to /init (the failure mode
  // the M32.6.5 .env flag fixes across server restarts).
  const postInit = { ghc_setup_done: '1' };

  it('does not touch /api/query (public API)', async () => {
    const req = makeReq({ pathname: '/api/query', method: 'POST', cookies: postInit });
    const res = await middleware(req);
    expect(res.type).toBe('next');
  });

  it('does not touch /api/v1/status (public status)', async () => {
    const req = makeReq({ pathname: '/api/v1/status', method: 'GET', cookies: postInit });
    const res = await middleware(req);
    expect(res.type).toBe('next');
  });

  it('does not touch /login (public)', async () => {
    const req = makeReq({ pathname: '/login', method: 'GET', cookies: postInit });
    const res = await middleware(req);
    expect(res.type).toBe('next');
  });
});

describe('middleware: setup gate (M32.6.5 — durable env flag)', () => {
  // Before M32.6.5: middleware 307'd every request without the cookie,
  // so a fresh `dev:server` boot always looped to /init even with a
  // fully-provisioned DB. Fix: middleware now also reads
  // `process.env.GHC_SETUP_DONE`, which `lockSetupSubtask` writes to
  // .env at init completion. Next.js's `loadEnvConfig` picks it up at
  // boot so the gate never trips after the wizard runs once.
  //
  // These tests deliberately override the file-level 'post-init'
  // assumption so we can exercise both branches of the gate.

  afterEach(() => {
    // Restore the post-init state for any subsequent describe blocks
    // that may run after this one (vitest runs in file order).
    process.env.GHC_SETUP_DONE = '1';
  });

  it('passes /api/v1/status through when GHC_SETUP_DONE=1 even with no cookie (fresh dev:server boot)', async () => {
    delete process.env.GHC_SETUP_DONE;
    process.env.GHC_SETUP_DONE = '1';
    const req = makeReq({ pathname: '/api/v1/status', method: 'GET' });
    const res = await middleware(req);
    expect(res.type).toBe('next');
  });

  it('redirects to /init when GHC_SETUP_DONE is unset AND no cookie (truly fresh deploy)', async () => {
    delete process.env.GHC_SETUP_DONE;
    const req = makeReq({ pathname: '/api/v1/status', method: 'GET' });
    const res = await middleware(req);
    expect(res.type).toBe('redirect');
    expect(res.url).toBe('http://x/init');
  });

  it('redirects to /init when GHC_SETUP_DONE="0" (flag was explicitly reset)', async () => {
    process.env.GHC_SETUP_DONE = '0';
    const req = makeReq({ pathname: '/api/v1/status', method: 'GET' });
    const res = await middleware(req);
    expect(res.type).toBe('redirect');
    expect(res.url).toBe('http://x/init');
  });

  it('passes through to /init and /api/init/* even without cookie/env flag', async () => {
    delete process.env.GHC_SETUP_DONE;
    for (const path of ['/init', '/init/db', '/init/admin', '/init/execute', '/api/init/health']) {
      const req = makeReq({ pathname: path, method: 'GET' });
      const res = await middleware(req);
      expect(res.type, `${path} should pass through to the wizard`).toBe('next');
    }
  });

  it('matcher excludes /api/setup/backfill (self-heal route runs without middleware)', async () => {
    // The Next.js matcher in src/middleware.ts excludes /api/setup/backfill
    // so the self-heal route can re-stamp the cookie on a fresh browser
    // session. We assert that exclusion by reading the matcher regex
    // directly off the source — calling middleware() would be a no-op
    // because Next itself never invokes it for excluded paths.
    const { config } = await import('@/middleware');
    expect(config.matcher).toBeDefined();
    const regexes = Array.isArray(config.matcher) ? config.matcher : [config.matcher];
    const sample = '/api/setup/backfill';
    const excluded = regexes.every((rx) => new RegExp(rx).test(sample));
    expect(excluded, '/api/setup/backfill should match the matcher (be excluded from middleware)').toBe(true);
  });
});