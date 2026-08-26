import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatDate,
  getArchived,
  getCreatedAt,
  getDefaultBranch,
  getDescription,
  getDisabled,
  getForks,
  getHomepage,
  getHtmlUrl,
  getLanguage,
  getLicenseName,
  getPushedAt,
  getStars,
  getTopics,
  getUpdatedAt,
  getWatchers,
} from '@/lib/repo/metadata';

describe('repo metadata helpers', () => {
  describe('getDescription', () => {
    it('returns string for valid description', () => {
      expect(getDescription({ description: 'Hello' })).toBe('Hello');
    });
    it('returns null for null description', () => {
      expect(getDescription({ description: null })).toBeNull();
    });
    it('returns null for missing key', () => {
      expect(getDescription({})).toBeNull();
    });
    it('returns null for non-string description', () => {
      expect(getDescription({ description: 42 })).toBeNull();
    });
    it('returns null for null meta', () => {
      expect(getDescription(null)).toBeNull();
    });
  });

  describe('getStars/Forks/Watchers', () => {
    it('returns number when present', () => {
      expect(getStars({ stars: 1234 })).toBe(1234);
      expect(getForks({ forks: 56 })).toBe(56);
      expect(getWatchers({ watchers: 7 })).toBe(7);
    });
    it('returns null for non-numbers', () => {
      expect(getStars({ stars: 'oops' })).toBeNull();
      expect(getStars({})).toBeNull();
    });
  });

  describe('getDefaultBranch / getLanguage / getHomepage', () => {
    it('returns string or null', () => {
      expect(getDefaultBranch({ defaultBranch: 'main' })).toBe('main');
      expect(getDefaultBranch({ defaultBranch: '' })).toBeNull();
      expect(getLanguage({ language: 'TypeScript' })).toBe('TypeScript');
      expect(getLanguage({ language: null })).toBeNull();
      expect(getHomepage({ homepage: 'https://example.com' })).toBe('https://example.com');
      expect(getHomepage({ homepage: '' })).toBeNull();
    });
  });

  describe('getLicenseName', () => {
    it('reads spdx_id from object', () => {
      expect(getLicenseName({ license: { spdx_id: 'MIT' } })).toBe('MIT');
    });
    it('falls back to name when spdx missing', () => {
      expect(getLicenseName({ license: { name: 'Apache License 2.0' } })).toBe(
        'Apache License 2.0',
      );
    });
    it('reads plain string', () => {
      expect(getLicenseName({ license: 'GPL-3.0' })).toBe('GPL-3.0');
    });
    it('returns null for missing', () => {
      expect(getLicenseName({})).toBeNull();
      expect(getLicenseName({ license: null })).toBeNull();
    });
  });

  describe('getTopics', () => {
    it('filters to strings', () => {
      expect(getTopics({ topics: ['cli', 'github', 1, null] })).toEqual(['cli', 'github']);
    });
    it('returns [] for missing', () => {
      expect(getTopics({})).toEqual([]);
    });
  });

  describe('date helpers', () => {
    it('parses ISO strings', () => {
      expect(getCreatedAt({ createdAt: '2026-08-16T03:44:08.210Z' })).toBe(
        '2026-08-16T03:44:08.210Z',
      );
      expect(getUpdatedAt({ updatedAt: '2026-08-16T03:44:08.210Z' })).toBe(
        '2026-08-16T03:44:08.210Z',
      );
      expect(getPushedAt({ pushedAt: '2026-08-16T03:44:08.210Z' })).toBe(
        '2026-08-16T03:44:08.210Z',
      );
    });
    it('returns null for missing', () => {
      expect(getCreatedAt({})).toBeNull();
    });
  });

  describe('getArchived / getDisabled', () => {
    it('returns true only when boolean true', () => {
      expect(getArchived({ archived: true })).toBe(true);
      expect(getArchived({ archived: false })).toBe(false);
      expect(getArchived({ archived: 'true' })).toBe(false);
    });
    it('returns false for missing', () => {
      expect(getDisabled({})).toBe(false);
    });
  });

  describe('getHtmlUrl', () => {
    it('constructs the canonical github URL', () => {
      expect(getHtmlUrl('vercel', 'next.js')).toBe('https://github.com/vercel/next.js');
    });
    it('encodes owner/name', () => {
      expect(getHtmlUrl('a b', 'c d')).toBe('https://github.com/a%20b/c%20d');
    });
  });

  describe('formatCount', () => {
    it('returns – for null', () => {
      expect(formatCount(null)).toBe('–');
    });
    it('keeps small numbers', () => {
      expect(formatCount(0)).toBe('0');
      expect(formatCount(999)).toBe('999');
    });
    it('formats thousands', () => {
      expect(formatCount(1500)).toBe('1.5k');
      expect(formatCount(243_000)).toBe('243.0k');
    });
    it('formats millions', () => {
      expect(formatCount(1_500_000)).toBe('1.5M');
    });
  });

  describe('formatDate', () => {
    it('returns – for null/undefined', () => {
      expect(formatDate(null)).toBe('–');
      expect(formatDate(undefined)).toBe('–');
    });
    it('formats ISO string', () => {
      expect(formatDate('2026-08-16T03:44:08.210Z')).toBe('2026-08-16');
    });
    it('formats Date object', () => {
      expect(formatDate(new Date('2026-01-02T12:00:00Z'))).toBe('2026-01-02');
    });
    it('returns – for invalid string', () => {
      expect(formatDate('not-a-date')).toBe('–');
    });
  });
});