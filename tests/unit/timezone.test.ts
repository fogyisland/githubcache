import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEZONE,
  TIMEZONE_IDS,
  TIMEZONES,
  isTimezone,
  isValidIana,
  resolveTimezone,
  type TimezoneId,
} from '@/lib/timezone/registry';

describe('timezone registry', () => {
  it('has 17 curated zones', () => {
    expect(TIMEZONE_IDS).toHaveLength(17);
    expect(Object.keys(TIMEZONES)).toHaveLength(17);
  });

  it('every zone has metadata', () => {
    for (const id of TIMEZONE_IDS) {
      const z = TIMEZONES[id];
      expect(z.id).toBe(id);
      expect(z.label.length).toBeGreaterThan(0);
      expect(z.city.length).toBeGreaterThan(0);
      expect(z.offset.startsWith('UTC')).toBe(true);
    }
  });

  it('default is Asia/Shanghai', () => {
    expect(DEFAULT_TIMEZONE).toBe<TimezoneId>('Asia/Shanghai');
  });

  describe('isTimezone', () => {
    it('accepts known ids', () => {
      for (const id of TIMEZONE_IDS) {
        expect(isTimezone(id)).toBe(true);
      }
    });
    it('rejects unknown ids, including valid IANA strings outside the allowlist', () => {
      expect(isTimezone('Africa/Johannesburg')).toBe(false);
      expect(isTimezone('Pacific/Honolulu')).toBe(false);
      expect(isTimezone('Asia/Calcutta')).toBe(false); // valid IANA, not in allowlist
      expect(isTimezone('')).toBe(false);
    });
    it('rejects non-strings', () => {
      expect(isTimezone(null)).toBe(false);
      expect(isTimezone(undefined)).toBe(false);
      expect(isTimezone(42)).toBe(false);
      expect(isTimezone({})).toBe(false);
      expect(isTimezone(['UTC'])).toBe(false);
    });
  });

  describe('isValidIana', () => {
    it('accepts any valid IANA string', () => {
      expect(isValidIana('Africa/Johannesburg')).toBe(true);
      expect(isValidIana('Pacific/Honolulu')).toBe(true);
      expect(isValidIana('UTC')).toBe(true);
      expect(isValidIana('Asia/Shanghai')).toBe(true);
    });
    it('rejects garbage', () => {
      expect(isValidIana('Not/A_Zone')).toBe(false);
      expect(isValidIana('')).toBe(false);
      expect(isValidIana('foo bar')).toBe(false);
    });
  });

  describe('resolveTimezone', () => {
    it('cookie wins over db', () => {
      expect(
        resolveTimezone({ cookieValue: 'America/Los_Angeles', dbValue: 'Asia/Tokyo' }),
      ).toBe<TimezoneId>('America/Los_Angeles');
    });
    it('db wins over default when cookie is absent', () => {
      expect(resolveTimezone({ dbValue: 'Europe/Paris' })).toBe<TimezoneId>('Europe/Paris');
      expect(resolveTimezone({ cookieValue: null, dbValue: 'Europe/Paris' })).toBe<TimezoneId>(
        'Europe/Paris',
      );
    });
    it('falls through to default when both are missing', () => {
      expect(resolveTimezone({})).toBe(DEFAULT_TIMEZONE);
      expect(resolveTimezone({ cookieValue: null, dbValue: null })).toBe(DEFAULT_TIMEZONE);
    });
    it('falls through to default when both are invalid', () => {
      expect(
        resolveTimezone({ cookieValue: 'bogus', dbValue: 'also-bogus' }),
      ).toBe(DEFAULT_TIMEZONE);
    });
    it('falls through to db when cookie is invalid', () => {
      expect(
        resolveTimezone({ cookieValue: 'bogus', dbValue: 'Asia/Tokyo' }),
      ).toBe<TimezoneId>('Asia/Tokyo');
    });
  });
});
