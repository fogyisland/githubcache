import { describe, expect, it } from 'vitest';
import { LOCALES, defaultLocale } from '@/i18n/config';
import { isLocale, resolveLocale } from '@/lib/lang/registry';
import { readLangFromCookieHeader, buildLangSetCookie } from '@/lib/lang/cookie';

describe('i18n config', () => {
  it('LOCALES is the [zh, en] tuple', () => {
    expect(LOCALES).toEqual(['zh', 'en']);
  });

  it('defaultLocale is zh', () => {
    expect(defaultLocale).toBe('zh');
  });
});

describe('isLocale', () => {
  it('accepts valid locales', () => {
    expect(isLocale('zh')).toBe(true);
    expect(isLocale('en')).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale('ZH')).toBe(false); // case-sensitive
  });
});

describe('resolveLocale', () => {
  it('uses cookie when present', () => {
    expect(resolveLocale({ cookieValue: 'en', dbValue: 'zh', acceptLanguage: 'zh' })).toBe('en');
  });

  it('falls back to DB when cookie is missing', () => {
    expect(resolveLocale({ dbValue: 'en', acceptLanguage: 'zh' })).toBe('en');
  });

  it('falls back to Accept-Language when both cookie and DB are missing', () => {
    expect(resolveLocale({ acceptLanguage: 'en-US' })).toBe('en');
    expect(resolveLocale({ acceptLanguage: 'zh-CN' })).toBe('zh');
  });

  it('returns defaultLocale when nothing matches', () => {
    expect(resolveLocale({})).toBe(defaultLocale);
  });

  it('ignores invalid cookie and falls through to DB', () => {
    expect(resolveLocale({ cookieValue: 'fr', dbValue: 'en' })).toBe('en');
  });
});

describe('cookie helpers', () => {
  it('reads locale from raw cookie header', () => {
    expect(readLangFromCookieHeader('ghc_lang=en; ghc_theme=terminal')).toBe('en');
    expect(readLangFromCookieHeader('foo=bar; ghc_lang=zh')).toBe('zh');
  });

  it('returns null when missing or invalid', () => {
    expect(readLangFromCookieHeader(null)).toBeNull();
    expect(readLangFromCookieHeader('ghc_lang=fr')).toBeNull();
    expect(readLangFromCookieHeader('')).toBeNull();
  });

  it('builds a Set-Cookie value with 1-year MaxAge + SameSite=Lax', () => {
    const out = buildLangSetCookie('en');
    expect(out).toMatch(/^ghc_lang=en;/);
    expect(out).toContain('Max-Age=31536000'); // 60*60*24*365
    expect(out).toContain('Path=/');
    expect(out).toContain('SameSite=Lax');
  });
});
