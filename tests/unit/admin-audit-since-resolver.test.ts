import { describe, expect, it } from 'vitest';
import { resolveSince } from '@/app/admin/audit/since-resolver';

describe('resolveSince', () => {
  const now = new Date('2026-09-11T12:00:00Z');

  it('returns undefined for an undefined token', () => {
    expect(resolveSince(undefined, now)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(resolveSince('', now)).toBeUndefined();
  });

  it('translates 15m to 15 minutes before now', () => {
    const from = resolveSince('15m', now);
    expect(from).toBeDefined();
    expect(now.getTime() - (from as Date).getTime()).toBe(15 * 60_000);
  });

  it('translates 1h to 1 hour before now', () => {
    const from = resolveSince('1h', now);
    expect(now.getTime() - (from as Date).getTime()).toBe(60 * 60_000);
  });

  it('translates 24h to 24 hours before now', () => {
    const from = resolveSince('24h', now);
    expect(now.getTime() - (from as Date).getTime()).toBe(24 * 60 * 60_000);
  });

  it('translates 7d to 7 days before now', () => {
    const from = resolveSince('7d', now);
    expect(now.getTime() - (from as Date).getTime()).toBe(7 * 86_400_000);
  });

  it('returns undefined for an unknown unit', () => {
    expect(resolveSince('5y', now)).toBeUndefined();
  });

  it('returns undefined for a non-positive count', () => {
    expect(resolveSince('0m', now)).toBeUndefined();
    expect(resolveSince('-1h', now)).toBeUndefined();
  });

  it('returns undefined for garbage', () => {
    expect(resolveSince('abc', now)).toBeUndefined();
    expect(resolveSince('15', now)).toBeUndefined();
    expect(resolveSince('m15', now)).toBeUndefined();
  });

  it('returns undefined for n above the 365-unit cap', () => {
    // 99999999d would otherwise compute near MAX_SAFE_INTEGER.
    expect(resolveSince('99999999d', now)).toBeUndefined();
    expect(resolveSince('1000h', now)).toBeUndefined();
    expect(resolveSince('100000m', now)).toBeUndefined();
    // 365 is exactly the cap and should pass.
    expect(resolveSince('365d', now)).toBeDefined();
  });
});
