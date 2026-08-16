import { describe, it, expect } from 'vitest';
import {
  issueCsrfToken,
  setCsrfCookie,
  clearCsrfCookie,
  verifyCsrf,
  CSRF_COOKIE_NAME,
} from '@/lib/auth/csrf';

interface FakeReq {
  headers: Headers;
  cookies?: { get(name: string): { value: string } | undefined };
}

function makeReq(opts: { cookieValue?: string | null; headerValue?: string | null }): FakeReq {
  const headers = new Headers();
  const cookieVal = opts.cookieValue;
  if (cookieVal !== undefined && cookieVal !== null && cookieVal !== '') {
    headers.set('cookie', `${CSRF_COOKIE_NAME}=${cookieVal}`);
  }
  if (opts.headerValue !== undefined && opts.headerValue !== null && opts.headerValue !== '') {
    headers.set('x-csrf-token', opts.headerValue);
  }
  const req: FakeReq = { headers };
  req.cookies = {
    get: (name: string) =>
      name === CSRF_COOKIE_NAME && cookieVal ? { value: cookieVal } : undefined,
  };
  return req;
}

describe('CSRF token + verifyCsrf', () => {
  it('issueCsrfToken returns 64-hex string', () => {
    const token = issueCsrfToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('two issued tokens differ', () => {
    expect(issueCsrfToken()).not.toBe(issueCsrfToken());
  });

  it('verifyCsrf accepts matching cookie + header', () => {
    const token = issueCsrfToken();
    const req = makeReq({ cookieValue: token, headerValue: token });
    expect(verifyCsrf(req, token)).toBe(true);
  });

  it('verifyCsrf rejects missing cookie', () => {
    const token = issueCsrfToken();
    const req = makeReq({ headerValue: token });
    expect(verifyCsrf(req, token)).toBe(false);
  });

  it('verifyCsrf rejects missing header', () => {
    const token = issueCsrfToken();
    const req = makeReq({ cookieValue: token });
    expect(verifyCsrf(req, null)).toBe(false);
  });

  it('verifyCsrf rejects mismatched token', () => {
    const tokenA = issueCsrfToken();
    const tokenB = issueCsrfToken();
    const req = makeReq({ cookieValue: tokenA, headerValue: tokenB });
    expect(verifyCsrf(req, tokenB)).toBe(false);
  });

  it('verifyCsrf rejects when cookie and header length differ', () => {
    const req = makeReq({ cookieValue: 'short', headerValue: 'a-much-longer-token-here' });
    expect(verifyCsrf(req, 'a-much-longer-token-here')).toBe(false);
  });

  it('verifyCsrf rejects empty cookie or header', () => {
    const req1 = makeReq({ cookieValue: '', headerValue: 'something' });
    expect(verifyCsrf(req1, 'something')).toBe(false);
    const req2 = makeReq({ cookieValue: 'something', headerValue: '' });
    expect(verifyCsrf(req2, '')).toBe(false);
  });
});

describe('CSRF cookie helpers', () => {
  it('setCsrfCookie writes correct Set-Cookie (NOT httpOnly)', () => {
    const res = { headers: new Headers() };
    setCsrfCookie(res, 'csrf-token-abc');
    const cookie = res.headers.get('Set-Cookie');
    expect(cookie).not.toBeNull();
    expect(cookie!).toContain('ghc_csrf=csrf-token-abc');
    expect(cookie!).toContain('Path=/');
    expect(cookie!).toContain('SameSite=Lax');
    expect(cookie!).not.toContain('HttpOnly'); // MUST be readable
  });

  it('clearCsrfCookie sets Max-Age=0', () => {
    const res = { headers: new Headers() };
    clearCsrfCookie(res);
    const cookie = res.headers.get('Set-Cookie');
    expect(cookie).not.toBeNull();
    expect(cookie!).toContain('ghc_csrf=');
    expect(cookie!).toContain('Max-Age=0');
  });
});
