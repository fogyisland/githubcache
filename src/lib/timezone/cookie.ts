// M23 — read / write the `ghc_tz` cookie. Mirrors src/lib/lang/cookie.ts.

import { TIMEZONE_COOKIE_MAX_AGE_SECONDS, TIMEZONE_COOKIE_NAME } from './constants';
import { isTimezone, type TimezoneId } from './registry';

/**
 * Parse a `Cookie:` header value and return the `ghc_tz` value if present
 * AND a member of the curated allowlist. Returns `null` when the cookie is
 * absent or its value is not a recognized timezone — callers then fall
 * through to DB / default resolution.
 */
export function readTimezoneFromCookieHeader(
  header: string | null | undefined,
): TimezoneId | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey !== TIMEZONE_COOKIE_NAME) continue;
    const rawVal = rest.join('=').trim();
    if (isTimezone(rawVal)) return rawVal;
    return null;
  }
  return null;
}

/**
 * Build a `Set-Cookie` header value for the supplied timezone. URL-encoded
 * for consistency with the lang cookie (IANA strings are already URL-safe
 * but encoding keeps the round-trip symmetric with `readTimezoneFromCookieHeader`).
 */
export function buildTimezoneSetCookie(value: TimezoneId): string {
  const v = encodeURIComponent(value);
  return `${TIMEZONE_COOKIE_NAME}=${v}; Max-Age=${TIMEZONE_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}
