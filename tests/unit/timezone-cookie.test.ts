import { describe, expect, it } from 'vitest';
import {
  TIMEZONE_COOKIE_MAX_AGE_SECONDS,
  TIMEZONE_COOKIE_NAME,
} from '@/lib/timezone/constants';
import {
  buildTimezoneSetCookie,
  readTimezoneFromCookieHeader,
} from '@/lib/timezone/cookie';
import { TIMEZONE_IDS, type TimezoneId } from '@/lib/timezone/registry';

describe('timezone cookie helper', () => {
  describe('readTimezoneFromCookieHeader', () => {
    it('parses a valid timezone from a single cookie', () => {
      const header = `${TIMEZONE_COOKIE_NAME}=Asia/Shanghai`;
      expect(readTimezoneFromCookieHeader(header)).toBe<TimezoneId>('Asia/Shanghai');
    });

    it('parses a valid timezone among multiple cookies', () => {
      const header = `ghc_theme=terminal; ${TIMEZONE_COOKIE_NAME}=America/New_York; ghc_lang=zh`;
      expect(readTimezoneFromCookieHeader(header)).toBe<TimezoneId>('America/New_York');
    });

    it('returns null for unknown timezone value', () => {
      const header = `${TIMEZONE_COOKIE_NAME}=Africa/Johannesburg`;
      expect(readTimezoneFromCookieHeader(header)).toBeNull();
    });

    it('returns null when the cookie is absent', () => {
      expect(readTimezoneFromCookieHeader('ghc_theme=terminal; ghc_lang=zh')).toBeNull();
      expect(readTimezoneFromCookieHeader('')).toBeNull();
      expect(readTimezoneFromCookieHeader(null)).toBeNull();
      expect(readTimezoneFromCookieHeader(undefined)).toBeNull();
    });

    it('round-trips every curated timezone id', () => {
      for (const id of TIMEZONE_IDS) {
        const header = `${TIMEZONE_COOKIE_NAME}=${id}`;
        expect(readTimezoneFromCookieHeader(header)).toBe<TimezoneId>(id);
      }
    });
  });

  describe('buildTimezoneSetCookie', () => {
    it('encodes the value with the cookie name and 1-year max-age', () => {
      const cookie = buildTimezoneSetCookie('Asia/Shanghai');
      expect(cookie).toContain(`${TIMEZONE_COOKIE_NAME}=Asia%2FShanghai`);
      expect(cookie).toContain(`Max-Age=${TIMEZONE_COOKIE_MAX_AGE_SECONDS}`);
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('encodes slashes inside the IANA string', () => {
      const cookie = buildTimezoneSetCookie('America/Los_Angeles');
      expect(cookie).toContain('America%2FLos_Angeles');
    });
  });
});
