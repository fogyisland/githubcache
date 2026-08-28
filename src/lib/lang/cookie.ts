/**
 * Cookie helpers for the `ghc_lang` cookie. Mirror of `src/lib/theme/cookie.ts`.
 *
 * Note: imports `cookies` from `next/headers` ONLY in server code paths
 * that already had that import (e.g. login route, root layout). For
 * `cookiesFromRequest`-style usage in tests/route handlers, see
 * `readLangFromRequest` and `buildLangSetCookie`.
 */

import { LANG_COOKIE_NAME, LANG_COOKIE_MAX_AGE_SECONDS } from './constants';
import { isLocale, type Locale } from '@/lib/lang/registry';

export const LANG_COOKIE = LANG_COOKIE_NAME;
export const LANG_MAX_AGE = LANG_COOKIE_MAX_AGE_SECONDS;

/**
 * Parse a raw `Cookie:` header value and return the first matching `ghc_lang=...`.
 * Returns null if absent or invalid. Does NOT depend on `next/headers`.
 */
export function readLangFromCookieHeader(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey !== LANG_COOKIE_NAME) continue;
    const rawVal = rest.join('=').trim();
    if (isLocale(rawVal)) return rawVal;
    return null;
  }
  return null;
}

/**
 * Build a `Set-Cookie` header value for the given locale.
 * 1 year MaxAge, Path=/, SameSite=Lax. No Secure flag (HTTP dev + TLS reverse proxy in prod).
 */
export function buildLangSetCookie(value: Locale): string {
  const v = encodeURIComponent(value);
  return `${LANG_COOKIE_NAME}=${v}; Max-Age=${LANG_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}
