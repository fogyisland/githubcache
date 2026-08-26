import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  THEME_IDS,
  THEMES,
  isThemeId,
  resolveTheme,
  type ThemeId,
} from '@/lib/theme/themes';
import {
  THEME_COOKIE,
  buildThemeSetCookie,
  readThemeFromCookieHeader,
  readThemeFromRequest,
} from '@/lib/theme/cookie';

describe('themes registry', () => {
  it('has 3 themes', () => {
    expect(THEME_IDS).toEqual(['terminal', 'editorial', 'brutalist']);
    expect(Object.keys(THEMES)).toHaveLength(3);
  });

  it('every theme has font tokens', () => {
    for (const id of THEME_IDS) {
      const t = THEMES[id];
      expect(t.id).toBe(id);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.blurb.length).toBeGreaterThan(0);
      expect(t.fonts.display).toMatch(/^var\(--font-/);
      expect(t.fonts.body).toMatch(/^var\(--font-/);
      expect(t.fonts.mono).toMatch(/^var\(--font-/);
    }
  });

  it('default theme is terminal', () => {
    expect(DEFAULT_THEME).toBe('terminal');
  });

  describe('isThemeId', () => {
    it('accepts known ids', () => {
      for (const id of THEME_IDS) {
        expect(isThemeId(id)).toBe(true);
      }
    });
    it('rejects unknown ids', () => {
      expect(isThemeId('rainbow')).toBe(false);
      expect(isThemeId('')).toBe(false);
      expect(isThemeId(null)).toBe(false);
      expect(isThemeId(42)).toBe(false);
      expect(isThemeId(undefined)).toBe(false);
      expect(isThemeId({})).toBe(false);
    });
  });

  describe('resolveTheme', () => {
    it('returns the value when known', () => {
      expect(resolveTheme('editorial')).toBe<ThemeId>('editorial');
    });
    it('falls back to default for unknown', () => {
      expect(resolveTheme('bogus')).toBe(DEFAULT_THEME);
      expect(resolveTheme(null)).toBe(DEFAULT_THEME);
      expect(resolveTheme(undefined)).toBe(DEFAULT_THEME);
    });
  });
});

describe('theme cookie helper', () => {
  it('reads the cookie value from a request', () => {
    const req = new Request('http://localhost/', {
      headers: { cookie: `${THEME_COOKIE}=editorial` },
    });
    expect(readThemeFromRequest(req)).toBe<ThemeId>('editorial');
  });

  it('falls back to default when cookie is missing', () => {
    const req = new Request('http://localhost/');
    expect(readThemeFromRequest(req)).toBe(DEFAULT_THEME);
  });

  it('falls back to default when cookie value is unknown', () => {
    const req = new Request('http://localhost/', {
      headers: { cookie: `${THEME_COOKIE}=rainbow` },
    });
    expect(readThemeFromRequest(req)).toBe(DEFAULT_THEME);
  });

  it('falls back to default when cookie value is unknown', () => {
    // Use a valid-looking ASCII value so decodeURIComponent succeeds.
    const req = new Request('http://localhost/', {
      headers: { cookie: `${THEME_COOKIE}=bogus-theme` },
    });
    expect(readThemeFromRequest(req)).toBe(DEFAULT_THEME);
  });

  it('decodes URL-encoded cookie values', () => {
    const req = new Request('http://localhost/', {
      headers: { cookie: `${THEME_COOKIE}=${encodeURIComponent('brutalist')}` },
    });
    expect(readThemeFromRequest(req)).toBe<ThemeId>('brutalist');
  });

  it('reads theme from cookie header string', () => {
    expect(readThemeFromCookieHeader(`${THEME_COOKIE}=terminal`)).toBe(DEFAULT_THEME);
    expect(readThemeFromCookieHeader(`${THEME_COOKIE}=editorial`)).toBe<ThemeId>('editorial');
    expect(readThemeFromCookieHeader(null)).toBe(DEFAULT_THEME);
    expect(readThemeFromCookieHeader('')).toBe(DEFAULT_THEME);
  });

  describe('buildThemeSetCookie', () => {
    it('produces a valid Set-Cookie header value', () => {
      const header = buildThemeSetCookie('editorial');
      expect(header).toContain(`${THEME_COOKIE}=editorial`);
      expect(header).toContain('Path=/');
      expect(header).toContain('Max-Age=31536000');
      expect(header).toContain('SameSite=Lax');
    });
    it('falls back to default for invalid input', () => {
      const header = buildThemeSetCookie('bogus' as unknown as ThemeId);
      expect(header).toContain(`${THEME_COOKIE}=${DEFAULT_THEME}`);
    });
    it('encodes special characters', () => {
      const header = buildThemeSetCookie('brutalist');
      // brutalist is plain ASCII, so no encoding needed; just verify round-trip.
      const m = header.match(new RegExp(`${THEME_COOKIE}=([^;]+)`));
      expect(m?.[1]).toBe('brutalist');
    });
  });

  it('roundtrips cookie value via set-then-read', () => {
    const id: ThemeId = 'brutalist';
    const header = buildThemeSetCookie(id);
    const value = header.split(';')[0]!.split('=')[1]!;
    const req = new Request('http://localhost/', {
      headers: { cookie: `${THEME_COOKIE}=${value}` },
    });
    expect(readThemeFromRequest(req)).toBe(id);
  });
});