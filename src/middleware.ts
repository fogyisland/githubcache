import { NextResponse, type NextRequest } from 'next/server';
import { getSessionIdFromCookie } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { applyRequestId } from '@/lib/api/request-id';

/**
 * Next.js 14 middleware for the entire app.
 *
 * Runs on the Edge runtime (no Node.js APIs, no Prisma). Does:
 *
 * 1. **Request-id stamping (M15)** — every response (success, redirect,
 *    error) carries `x-request-id`. Inbound header echoed if valid;
 *    otherwise a fresh UUID generated via Web Crypto. Edge-safe.
 *
 * 2. **`/admin/*` pages** — if no session cookie, redirect to `/login`.
 *    Cookie existence is NOT full session validation — expired/forged
 *    cookies pass middleware but fail at the page level (which calls
 *    the full `validateSession` from @/lib/auth/session).
 *
 * 3. **`/api/admin/*` non-GET** — require CSRF token (double-submit pattern:
 *    `ghc_csrf` cookie value must match `X-CSRF-Token` header). GETs
 *    are exempt (idempotent reads).
 *
 * 4. **M28.bug12 — setup wizard gate**: when the `ghc_setup_done=1` cookie
 *    is absent (fresh deploy that hasn't run `/init` yet), redirect every
 *    non-`/init` request to `/init` so the operator is forced through DB
 *    config + admin bootstrap. The wizard sets the cookie via a Server
 *    Action at the very end, after migrations + admin creation succeed.
 *
 * CSRF failure body intentionally stays as `{error: 'csrf'}` (legacy
 * shape) — admin CSRF failures are not part of the M15 OpenAPI surface.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const path = req.nextUrl.pathname;

  // --- M28.bug12: setup wizard gate ----------------------------------------
  // Cookie-not-set = fresh deploy. PinYinCharacter uses a DB flag for this,
  // which we can't (DB isn't set up yet). A long-lived cookie is the
  // cheapest Edge-runtime-safe signal. Set when the wizard finishes.
  const setupDone = req.cookies.get('ghc_setup_done')?.value === '1';
  if (!setupDone && !path.startsWith('/init') && !path.startsWith('/api/init')) {
    const initUrl = new URL('/init', req.url);
    const redirectRes = NextResponse.redirect(initUrl);
    return applyRequestId(req, redirectRes);
  }
  // Once setup is done, /init and /api/init become inaccessible — middleware
  // bounces back to / so a stale browser bookmark can't re-enter the wizard.
  if (setupDone && (path === '/init' || path.startsWith('/init/') || path.startsWith('/api/init'))) {
    const homeRes = NextResponse.redirect(new URL('/', req.url));
    return applyRequestId(req, homeRes);
  }

  // Page-level admin auth: redirect to /login if no session cookie
  if (path.startsWith('/admin')) {
    const sessionId = getSessionIdFromCookie(req);
    if (!sessionId) {
      const loginUrl = new URL('/login', req.url);
      const redirectRes = NextResponse.redirect(loginUrl);
      return applyRequestId(req, redirectRes);
    }
    // Cookie exists — let the page render. Page-level validation will
    // do the DB lookup and handle expired/forged cookies.
    const res = NextResponse.next();
    // Expose pathname to server components (used by admin layout to
    // highlight the active sidebar section).
    res.headers.set('x-pathname', path);
    return applyRequestId(req, res);
  }

  // API-level CSRF: block non-GET /api/admin/* without valid CSRF
  if (path.startsWith('/api/admin') && req.method !== 'GET') {
    const headerToken = req.headers.get('x-csrf-token');
    if (!verifyCsrf(req, headerToken)) {
      const csrfRes = NextResponse.json({ error: 'csrf' }, { status: 403 });
      return applyRequestId(req, csrfRes);
    }
  }

  // Default path — stamp request-id then continue.
  const res = NextResponse.next();
  return applyRequestId(req, res);
}

export const config = {
  // Match every route EXCEPT Next internals + static assets. We need
  // global coverage so request-id stamping applies to public API and
  // docs endpoints (M15).
  // Note: Next.js middleware matcher does NOT support capturing groups
  // inside the negative lookahead. Use a single alternation per file.
  matcher: [
    '/((?!_next|_next/static|_next/image|favicon.ico).*)',
  ],
};