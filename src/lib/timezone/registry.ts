// M23 — per-user timezone preference registry.
//
// Curated allowlist of 17 IANA timezones covering the operator audience.
// `resolveTimezone` falls back to `DEFAULT_TIMEZONE` (Asia/Shanghai) when
// neither the cookie nor the DB value is set or recognized. The validator
// `isTimezone` only accepts strings from the curated list — `isValidIana`
// is provided for a future "any IANA string" extension (out of scope for
// M23).

export const TIMEZONE_IDS = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

export type TimezoneId = (typeof TIMEZONE_IDS)[number];

export const DEFAULT_TIMEZONE: TimezoneId = 'Asia/Shanghai';

export interface TimezoneMeta {
  /** Stable id, also the cookie / DB value. */
  id: TimezoneId;
  /** Short pill-style label, e.g. "Shanghai". */
  label: string;
  /** City + IANA string for the <option> element, e.g. "Shanghai — Asia/Shanghai". */
  city: string;
  /** Non-DST winter UTC offset, e.g. "UTC+8" — for the <option> chip. */
  offset: string;
}

export const TIMEZONES: Record<TimezoneId, TimezoneMeta> = {
  UTC:                 { id: 'UTC',                 label: 'UTC',         city: 'UTC — UTC',                          offset: 'UTC+0' },
  'Asia/Shanghai':     { id: 'Asia/Shanghai',       label: 'Shanghai',    city: 'Shanghai — Asia/Shanghai',           offset: 'UTC+8' },
  'Asia/Tokyo':        { id: 'Asia/Tokyo',          label: 'Tokyo',       city: 'Tokyo — Asia/Tokyo',                 offset: 'UTC+9' },
  'Asia/Singapore':    { id: 'Asia/Singapore',      label: 'Singapore',   city: 'Singapore — Asia/Singapore',         offset: 'UTC+8' },
  'Asia/Hong_Kong':    { id: 'Asia/Hong_Kong',      label: 'Hong Kong',   city: 'Hong Kong — Asia/Hong_Kong',         offset: 'UTC+8' },
  'Asia/Kolkata':      { id: 'Asia/Kolkata',        label: 'Kolkata',     city: 'Kolkata — Asia/Kolkata',             offset: 'UTC+5:30' },
  'Europe/London':     { id: 'Europe/London',       label: 'London',      city: 'London — Europe/London',             offset: 'UTC+0' },
  'Europe/Paris':      { id: 'Europe/Paris',        label: 'Paris',       city: 'Paris — Europe/Paris',               offset: 'UTC+1' },
  'Europe/Berlin':     { id: 'Europe/Berlin',       label: 'Berlin',      city: 'Berlin — Europe/Berlin',             offset: 'UTC+1' },
  'Europe/Moscow':     { id: 'Europe/Moscow',       label: 'Moscow',      city: 'Moscow — Europe/Moscow',             offset: 'UTC+3' },
  'America/New_York':  { id: 'America/New_York',    label: 'New York',    city: 'New York — America/New_York',        offset: 'UTC-5' },
  'America/Chicago':   { id: 'America/Chicago',     label: 'Chicago',     city: 'Chicago — America/Chicago',          offset: 'UTC-6' },
  'America/Denver':    { id: 'America/Denver',      label: 'Denver',      city: 'Denver — America/Denver',            offset: 'UTC-7' },
  'America/Los_Angeles':{ id: 'America/Los_Angeles', label: 'Los Angeles', city: 'Los Angeles — America/Los_Angeles', offset: 'UTC-8' },
  'America/Sao_Paulo': { id: 'America/Sao_Paulo',   label: 'Sao Paulo',   city: 'Sao Paulo — America/Sao_Paulo',      offset: 'UTC-3' },
  'Australia/Sydney':  { id: 'Australia/Sydney',    label: 'Sydney',      city: 'Sydney — Australia/Sydney',          offset: 'UTC+11' },
  'Pacific/Auckland':  { id: 'Pacific/Auckland',    label: 'Auckland',    city: 'Auckland — Pacific/Auckland',        offset: 'UTC+13' },
};

/**
 * Type guard for the curated allowlist. Returns `true` only for strings
 * that are members of `TIMEZONE_IDS`. Unknown IANA strings (e.g.
 * `Africa/Johannesburg`) are intentionally rejected — operators must
 * extend the allowlist to expose a new zone.
 */
export function isTimezone(value: unknown): value is TimezoneId {
  return typeof value === 'string' && (TIMEZONE_IDS as readonly string[]).includes(value);
}

/**
 * Validates ANY IANA timezone string via a round-trip through
 * `Intl.DateTimeFormat`. Reserved for a future "typed-in zone" extension
 * to the switcher; not used by M23's curated allowlist.
 */
export function isValidIana(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the effective timezone for a request. Cookie wins over DB
 * (most-recent user choice), DB wins over the default. No Accept-Language
 * fallback — language headers don't imply timezone (Paris ≠ Paris, TX).
 */
export function resolveTimezone(opts: {
  cookieValue?: string | null;
  dbValue?: string | null;
}): TimezoneId {
  if (isTimezone(opts.cookieValue)) return opts.cookieValue;
  if (isTimezone(opts.dbValue)) return opts.dbValue;
  return DEFAULT_TIMEZONE;
}
