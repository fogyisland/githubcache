import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatTime } from '@/lib/format/datetime';
import { DEFAULT_TIMEZONE } from '@/lib/timezone/registry';

// A handful of pinned UTC instants for cross-tz assertions. Each test
// documents what the output should be in a specific zone so a future
// refactor of the formatter has a quick regression net.
const UTC_MIDNIGHT = new Date('2026-08-15T00:00:00Z');
const UTC_AFTERNOON = new Date('2026-08-15T08:30:45Z');

describe('formatDate', () => {
  it('formats UTC midnight in UTC as the same calendar date', () => {
    expect(formatDate(UTC_MIDNIGHT, 'UTC')).toBe('2026-08-15');
  });

  it('formats UTC midnight in Asia/Shanghai (UTC+8) as the same calendar date', () => {
    // 00:00 UTC = 08:00 Asia/Shanghai → still 2026-08-15
    expect(formatDate(UTC_MIDNIGHT, 'Asia/Shanghai')).toBe('2026-08-15');
  });

  it('rolls back a day when UTC is late evening in negative-offset zones', () => {
    // 03:00 UTC on 2026-08-15 → 20:00 the previous day in LA (UTC-7 in Aug DST)
    expect(formatDate(UTC_MIDNIGHT, 'America/Los_Angeles')).toBe('2026-08-14');
  });

  it('rolls forward a day in positive-offset zones when UTC is very early morning', () => {
    // 20:00 UTC on 2026-08-14 → 04:00 next day in Asia/Shanghai (UTC+8)
    const eveUtc = new Date('2026-08-14T20:00:00Z');
    expect(formatDate(eveUtc, 'Asia/Shanghai')).toBe('2026-08-15');
  });

  it('returns en-dash for null / undefined input', () => {
    expect(formatDate(null, 'UTC')).toBe('-');
    expect(formatDate(undefined, 'UTC')).toBe('-');
  });

  it('returns en-dash for invalid date string', () => {
    expect(formatDate('not-a-date', 'UTC')).toBe('-');
  });

  it('accepts an ISO string as input', () => {
    expect(formatDate('2026-08-15T00:00:00Z', 'Asia/Shanghai')).toBe('2026-08-15');
  });

  it('falls back to default tz on invalid tz arg', () => {
    // `bogus` is not in the curated list; isTimezone returns false so the
    // formatter should use DEFAULT_TIMEZONE (Asia/Shanghai).
    expect(formatDate(UTC_MIDNIGHT, 'bogus' as never)).toBe(formatDate(UTC_MIDNIGHT, DEFAULT_TIMEZONE));
  });
});

describe('formatDateTime', () => {
  it('formats 24h with seconds in UTC', () => {
    expect(formatDateTime(UTC_AFTERNOON, 'UTC')).toBe('2026-08-15 08:30:45');
  });

  it('shifts the time portion in Asia/Shanghai (UTC+8)', () => {
    // 08:30:45 UTC → 16:30:45 Asia/Shanghai
    expect(formatDateTime(UTC_AFTERNOON, 'Asia/Shanghai')).toBe('2026-08-15 16:30:45');
  });

  it('shifts the date portion when the UTC time wraps midnight', () => {
    // 16:00 UTC on 2026-08-14 → 00:00 next day in Asia/Shanghai
    const wrapUtc = new Date('2026-08-14T16:00:00Z');
    expect(formatDateTime(wrapUtc, 'Asia/Shanghai')).toBe('2026-08-15 00:00:00');
  });

  it('returns en-dash for null input', () => {
    expect(formatDateTime(null, 'UTC')).toBe('-');
  });

  it('falls back to default tz on invalid tz arg', () => {
    expect(formatDateTime(UTC_AFTERNOON, 'bogus' as never)).toBe(
      formatDateTime(UTC_AFTERNOON, DEFAULT_TIMEZONE),
    );
  });
});

describe('formatTime', () => {
  it('formats HH:MM in UTC', () => {
    expect(formatTime(UTC_AFTERNOON, 'UTC')).toBe('08:30');
  });

  it('shifts the time in Asia/Shanghai (UTC+8)', () => {
    expect(formatTime(UTC_AFTERNOON, 'Asia/Shanghai')).toBe('16:30');
  });

  it('wraps around midnight when needed', () => {
    // 23:30 UTC → 07:30 next day in Asia/Shanghai
    const lateUtc = new Date('2026-08-14T23:30:00Z');
    expect(formatTime(lateUtc, 'Asia/Shanghai')).toBe('07:30');
  });

  it('returns en-dash for null input', () => {
    expect(formatTime(null, 'UTC')).toBe('-');
  });

  it('falls back to default tz on invalid tz arg', () => {
    expect(formatTime(UTC_AFTERNOON, 'bogus' as never)).toBe(
      formatTime(UTC_AFTERNOON, DEFAULT_TIMEZONE),
    );
  });
});
