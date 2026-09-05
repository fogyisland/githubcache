// M23 — timezone-aware date formatter. Replaces the inline
// `d.toISOString().slice(...)` and `.replace('T', ' ').slice(...)` patterns
// across the admin surface.
//
// Uses `Intl.DateTimeFormat('en-CA', { timeZone, hour12: false })` for a
// stable `YYYY-MM-DD` ordering and 24h zero-padding regardless of the
// runtime locale. Falls back to `DEFAULT_TIMEZONE` (Asia/Shanghai) on
// invalid TZ input — logs a warning so drift can be investigated.

import {
  DEFAULT_TIMEZONE,
  isTimezone,
  type TimezoneId,
} from '@/lib/timezone/registry';

/** Format `d` as `YYYY-MM-DD` in the given timezone. */
export function formatDate(
  d: Date | string | null | undefined,
  tz: TimezoneId,
): string {
  const date = toDate(d);
  if (!date) return '-';
  return formatParts(date, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, '-');
}

/** Format `d` as `YYYY-MM-DD HH:MM:SS` (24h) in the given timezone. */
export function formatDateTime(
  d: Date | string | null | undefined,
  tz: TimezoneId,
): string {
  const date = toDate(d);
  if (!date) return '-';
  return formatParts(
    date,
    tz,
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    },
    '-',
    ' ',
  );
}

/** Format `d` as `HH:MM` (24h) in the given timezone. */
export function formatTime(
  d: Date | string | null | undefined,
  tz: TimezoneId,
): string {
  const date = toDate(d);
  if (!date) return '-';
  return formatParts(
    date,
    tz,
    { hour: '2-digit', minute: '2-digit', hour12: false },
    '',
    '',
  );
}

function toDate(d: Date | string | null | undefined): Date | null {
  if (d === null || d === undefined) return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : new Date(t);
}

function formatParts(
  d: Date,
  tz: TimezoneId,
  opts: Intl.DateTimeFormatOptions,
  dateSep: string,
  dateTimeSep?: string,
): string {
  const safeTz: TimezoneId = isTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: safeTz });
  } catch (e: unknown) {
    // eslint-disable-next-line no-console
    console.warn('[datetime] invalid timezone, falling back to default:', safeTz, e);
    fmt = new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: DEFAULT_TIMEZONE });
  }
  const parts = fmt.formatToParts(d);
  const get = (k: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === k)?.value ?? '';

  const yyyy = get('year');
  const mm = pad(get('month'));
  const dd = pad(get('day'));
  const HH = get('hour');
  const MM = pad(get('minute'));
  const SS = pad(get('second'));

  // Branch on which fields were requested, mirroring the public function
  // signatures (formatTime / formatDate / formatDateTime).
  if (opts.hour === undefined) return `${yyyy}${dateSep}${mm}${dateSep}${dd}`;
  if (opts.year === undefined) return `${HH}:${MM}`;
  return `${yyyy}${dateSep}${mm}${dateSep}${dd}${dateTimeSep}${HH}:${MM}:${SS}`;
}

function pad(s: string): string {
  return s.length === 1 ? `0${s}` : s;
}
