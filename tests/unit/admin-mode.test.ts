import { describe, expect, it } from 'vitest';
import {
  ADMIN_MODES,
  ADMIN_MODE_IDS,
  DEFAULT_ADMIN_MODE,
  isAdminMode,
  resolveAdminMode,
  type AdminModeId,
} from '@/lib/admin/mode';
import {
  readAdminModeFromCookieHeader,
  readAdminModeFromRequest,
  buildAdminModeSetCookie,
} from '@/lib/admin/cookie';

describe('admin mode registry', () => {
  it('exposes exactly two modes (light + dark)', () => {
    expect(ADMIN_MODE_IDS).toEqual(['light', 'dark']);
    expect(ADMIN_MODES.light.id).toBe('light');
    expect(ADMIN_MODES.dark.id).toBe('dark');
  });

  it('defaults to light when no preference is given', () => {
    expect(DEFAULT_ADMIN_MODE).toBe('light');
    expect(resolveAdminMode(undefined)).toBe('light');
    expect(resolveAdminMode(null)).toBe('light');
  });

  it('accepts known mode ids and rejects everything else', () => {
    for (const m of ADMIN_MODE_IDS) {
      expect(isAdminMode(m)).toBe(true);
      expect(resolveAdminMode(m)).toBe(m);
    }
    expect(isAdminMode('auto')).toBe(false);
    expect(isAdminMode('LIGHT')).toBe(false); // case-sensitive
    expect(isAdminMode('')).toBe(false);
    expect(resolveAdminMode('auto')).toBe(DEFAULT_ADMIN_MODE);
  });
});

describe('admin mode cookie reader', () => {
  function makeReq(cookieHeader: string | null): Request {
    return {
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'cookie' ? cookieHeader : null,
      },
    } as unknown as Request;
  }

  it('returns the default when the cookie header is absent', () => {
    expect(readAdminModeFromRequest(makeReq(null))).toBe(DEFAULT_ADMIN_MODE);
    expect(readAdminModeFromCookieHeader(null)).toBe(DEFAULT_ADMIN_MODE);
  });

  it('parses the ghc_admin_mode cookie when present and valid', () => {
    expect(readAdminModeFromRequest(makeReq('ghc_admin_mode=light'))).toBe('light');
    expect(readAdminModeFromRequest(makeReq('ghc_admin_mode=dark'))).toBe('dark');
    // Other cookies alongside it
    expect(
      readAdminModeFromRequest(makeReq('theme=terminal; ghc_admin_mode=light')),
    ).toBe('light');
  });

  it('falls back to default on malformed / unknown values', () => {
    expect(readAdminModeFromRequest(makeReq('ghc_admin_mode=auto'))).toBe(
      DEFAULT_ADMIN_MODE,
    );
    expect(readAdminModeFromRequest(makeReq('ghc_admin_mode='))).toBe(
      DEFAULT_ADMIN_MODE,
    );
  });
});

describe('buildAdminModeSetCookie', () => {
  it('emits a SameSite=Lax cookie with a 1-year max-age', () => {
    const out = buildAdminModeSetCookie('light');
    expect(out.startsWith('ghc_admin_mode=light;')).toBe(true);
    expect(out).toContain('Path=/');
    expect(out).toContain('SameSite=Lax');
    expect(out).toMatch(/Max-Age=31536000/);
  });

  it('falls back to the default when given an unknown id', () => {
    const out = buildAdminModeSetCookie('auto' as AdminModeId);
    expect(out.startsWith(`ghc_admin_mode=${DEFAULT_ADMIN_MODE};`)).toBe(true);
  });
});
