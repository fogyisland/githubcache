/**
 * Minimal cookie getter interface. Compatible with the shape that
 * `validateSession` reads via `req.cookies?.get(name)?.value` in
 * src/lib/auth/session.ts.
 */
export interface CookieGetter {
  get(name: string): { value: string } | undefined;
}

/**
 * Build a `{get}` adapter from the raw `Cookie` request header.
 *
 * Most route handlers receive a Next.js `Request` (Web API) rather than a
 * `NextRequest` that exposes `req.cookies` directly. We parse the
 * `Cookie` header into a name → value map and expose only the `get`
 * shim that `validateSession` requires.
 *
 * Shared across the three admin-user route handlers to avoid drift
 * (extracted from cookiesFromRequest duplicates in M7.1 round 1).
 */
export function cookiesFromRequest(req: Request): CookieGetter {
  const raw = req.headers.get('cookie') ?? '';
  const map = new Map<string, string>();
  for (const part of raw.split(/;\s*/)) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    map.set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1)));
  }
  return {
    get: (name) => {
      const v = map.get(name);
      return v !== undefined ? { value: v } : undefined;
    },
  };
}
