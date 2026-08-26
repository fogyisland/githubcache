import { describe, expect, it } from 'vitest';
import {
  ADMIN_VARIANT_IDS,
  ADMIN_VARIANTS,
  DEFAULT_ADMIN_VARIANT,
  isAdminVariant,
  resolveAdminVariant,
  type AdminVariantId,
} from '@/lib/admin/variant';
import {
  ADMIN_VARIANT_COOKIE,
  buildAdminVariantSetCookie,
  readAdminVariantFromCookieHeader,
  readAdminVariantFromRequest,
} from '@/lib/admin/cookie';

describe('admin variant registry', () => {
  it('has 3 variants', () => {
    expect(ADMIN_VARIANT_IDS).toEqual(['mission_control', 'inspector', 'workbench']);
    expect(Object.keys(ADMIN_VARIANTS)).toHaveLength(3);
  });

  it('every variant has a label and blurb', () => {
    for (const id of ADMIN_VARIANT_IDS) {
      const v = ADMIN_VARIANTS[id];
      expect(v.id).toBe(id);
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.shortLabel.length).toBeGreaterThan(0);
      expect(v.blurb.length).toBeGreaterThan(0);
    }
  });

  it('default variant is mission_control', () => {
    expect(DEFAULT_ADMIN_VARIANT).toBe('mission_control');
  });

  describe('isAdminVariant', () => {
    it('accepts known ids', () => {
      for (const id of ADMIN_VARIANT_IDS) {
        expect(isAdminVariant(id)).toBe(true);
      }
    });
    it('rejects unknown ids', () => {
      expect(isAdminVariant('rainbow')).toBe(false);
      expect(isAdminVariant('')).toBe(false);
      expect(isAdminVariant(null)).toBe(false);
      expect(isAdminVariant(42)).toBe(false);
      expect(isAdminVariant(undefined)).toBe(false);
      expect(isAdminVariant({})).toBe(false);
    });
  });

  describe('resolveAdminVariant', () => {
    it('returns the value when known', () => {
      expect(resolveAdminVariant('inspector')).toBe<AdminVariantId>('inspector');
    });
    it('falls back to default for unknown', () => {
      expect(resolveAdminVariant('bogus')).toBe(DEFAULT_ADMIN_VARIANT);
      expect(resolveAdminVariant(null)).toBe(DEFAULT_ADMIN_VARIANT);
      expect(resolveAdminVariant(undefined)).toBe(DEFAULT_ADMIN_VARIANT);
    });
  });
});

describe('admin variant cookie helper', () => {
  it('reads the cookie value from a request', () => {
    const req = new Request('http://localhost/', {
      headers: { cookie: `${ADMIN_VARIANT_COOKIE}=inspector` },
    });
    expect(readAdminVariantFromRequest(req)).toBe<AdminVariantId>('inspector');
  });

  it('falls back to default when cookie is missing', () => {
    const req = new Request('http://localhost/');
    expect(readAdminVariantFromRequest(req)).toBe(DEFAULT_ADMIN_VARIANT);
  });

  it('falls back to default when cookie value is unknown', () => {
    const req = new Request('http://localhost/', {
      headers: { cookie: `${ADMIN_VARIANT_COOKIE}=rainbow` },
    });
    expect(readAdminVariantFromRequest(req)).toBe(DEFAULT_ADMIN_VARIANT);
  });

  it('falls back to default for malformed-but-parseable value', () => {
    const req = new Request('http://localhost/', {
      headers: { cookie: `${ADMIN_VARIANT_COOKIE}=bogus-variant` },
    });
    expect(readAdminVariantFromRequest(req)).toBe(DEFAULT_ADMIN_VARIANT);
  });

  it('decodes URL-encoded cookie values', () => {
    const req = new Request('http://localhost/', {
      headers: { cookie: `${ADMIN_VARIANT_COOKIE}=${encodeURIComponent('workbench')}` },
    });
    expect(readAdminVariantFromRequest(req)).toBe<AdminVariantId>('workbench');
  });

  it('reads variant from cookie header string', () => {
    expect(readAdminVariantFromCookieHeader(`${ADMIN_VARIANT_COOKIE}=mission_control`)).toBe(
      DEFAULT_ADMIN_VARIANT,
    );
    expect(readAdminVariantFromCookieHeader(`${ADMIN_VARIANT_COOKIE}=inspector`)).toBe<
      AdminVariantId
    >('inspector');
    expect(readAdminVariantFromCookieHeader(null)).toBe(DEFAULT_ADMIN_VARIANT);
    expect(readAdminVariantFromCookieHeader('')).toBe(DEFAULT_ADMIN_VARIANT);
  });

  describe('buildAdminVariantSetCookie', () => {
    it('produces a valid Set-Cookie header value', () => {
      const header = buildAdminVariantSetCookie('inspector');
      expect(header).toContain(`${ADMIN_VARIANT_COOKIE}=inspector`);
      expect(header).toContain('Path=/');
      expect(header).toContain('Max-Age=31536000');
      expect(header).toContain('SameSite=Lax');
    });
    it('falls back to default for invalid input', () => {
      const header = buildAdminVariantSetCookie('bogus' as unknown as AdminVariantId);
      expect(header).toContain(`${ADMIN_VARIANT_COOKIE}=${DEFAULT_ADMIN_VARIANT}`);
    });
    it('roundtrips a known variant', () => {
      const id: AdminVariantId = 'workbench';
      const header = buildAdminVariantSetCookie(id);
      const m = header.match(new RegExp(`${ADMIN_VARIANT_COOKIE}=([^;]+)`));
      expect(m?.[1]).toBe('workbench');
    });
  });

  it('roundtrips cookie value via set-then-read', () => {
    const id: AdminVariantId = 'inspector';
    const header = buildAdminVariantSetCookie(id);
    const value = header.split(';')[0]!.split('=')[1]!;
    const req = new Request('http://localhost/', {
      headers: { cookie: `${ADMIN_VARIANT_COOKIE}=${value}` },
    });
    expect(readAdminVariantFromRequest(req)).toBe(id);
  });
});