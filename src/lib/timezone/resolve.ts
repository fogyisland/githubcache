// M23 — SSR helper that resolves the effective timezone for a server
// component. Reads the `ghc_tz` cookie via `cookies()` from `next/headers`
// and combines it with the caller's `user.timezone` from `validateSession`.

import { cookies } from 'next/headers';
import { readTimezoneFromCookieHeader } from './cookie';
import { resolveTimezone, type TimezoneId } from './registry';

/**
 * Resolve the effective timezone for the current server-component render.
 *
 * Order (per `resolveTimezone`):
 *   1. `ghc_tz` cookie (most-recent user choice, takes precedence)
 *   2. `dbValue` (typically `user.timezone` from `validateSession`)
 *   3. `DEFAULT_TIMEZONE` (`Asia/Shanghai`)
 *
 * Admin pages already call `validateSession` inline; threading the DB
 * value through here avoids a second DB roundtrip. The cookie is read
 * from `next/headers`'s `cookies()` API which Next.js guarantees to
 * match the request that triggered this render.
 */
export async function resolveRequestTimezone(opts: {
  dbValue?: string | null;
}): Promise<TimezoneId> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return resolveTimezone({
    cookieValue: readTimezoneFromCookieHeader(cookieHeader),
    dbValue: opts.dbValue ?? null,
  });
}
