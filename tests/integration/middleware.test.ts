import { describe, it, expect, vi } from 'vitest';
import { middleware } from '@/middleware';
import type { NextRequest } from 'next/server';

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
  // Inject cookies API if cookies were provided
  if (opts.cookies) {
    (req as unknown as { cookies: { get(name: string): { value: string } | undefined } }).cookies = {
      get: (name: string) =>
        opts.cookies![name] !== undefined ? { value: opts.cookies![name]! } : undefined,
    };
  }
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

describe('middleware: non-admin paths', () => {
  it('does not touch /api/query (public API)', async () => {
    const req = makeReq({ pathname: '/api/query', method: 'POST' });
    const res = await middleware(req);
    expect(res.type).toBe('next');
  });

  it('does not touch /api/v1/status (public status)', async () => {
    const req = makeReq({ pathname: '/api/v1/status', method: 'GET' });
    const res = await middleware(req);
    expect(res.type).toBe('next');
  });

  it('does not touch /login (public)', async () => {
    const req = makeReq({ pathname: '/login', method: 'GET' });
    const res = await middleware(req);
    expect(res.type).toBe('next');
  });
});