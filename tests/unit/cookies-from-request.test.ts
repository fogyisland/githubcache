import { describe, it, expect } from 'vitest';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';

function reqWithCookie(cookie: string | undefined): Request {
  if (cookie === undefined) {
    return new Request('http://x');
  }
  return new Request('http://x', { headers: { cookie } });
}

describe('cookiesFromRequest', () => {
  it('returns undefined for any name when the Cookie header is absent', () => {
    const get = cookiesFromRequest(reqWithCookie(undefined));
    expect(get.get('any')).toBeUndefined();
    expect(get.get('ghc_admin_sid')).toBeUndefined();
  });

  it('returns undefined for any name when the Cookie header is empty', () => {
    const get = cookiesFromRequest(reqWithCookie(''));
    expect(get.get('any')).toBeUndefined();
    expect(get.get('ghc_admin_sid')).toBeUndefined();
  });

  it('parses a single cookie', () => {
    const get = cookiesFromRequest(reqWithCookie('foo=bar'));
    expect(get.get('foo')).toEqual({ value: 'bar' });
  });

  it('parses multiple cookies separated by "; "', () => {
    const get = cookiesFromRequest(reqWithCookie('a=1; b=2; c=3'));
    expect(get.get('a')).toEqual({ value: '1' });
    expect(get.get('b')).toEqual({ value: '2' });
    expect(get.get('c')).toEqual({ value: '3' });
  });

  it('skips segments without an "=" sign without throwing', () => {
    const get = cookiesFromRequest(reqWithCookie('a=1; broken; b=2'));
    expect(get.get('a')).toEqual({ value: '1' });
    expect(get.get('b')).toEqual({ value: '2' });
    expect(get.get('broken')).toBeUndefined();
  });

  it('percent-decodes cookie values per RFC 6265', () => {
    const get = cookiesFromRequest(reqWithCookie('foo=hello%20world'));
    expect(get.get('foo')).toEqual({ value: 'hello world' });
  });

  it('resolves the session cookie name used in production', () => {
    const get = cookiesFromRequest(reqWithCookie('ghc_admin_sid=abc123'));
    expect(get.get('ghc_admin_sid')).toEqual({ value: 'abc123' });
  });
});