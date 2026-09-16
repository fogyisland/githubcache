import { NextResponse, type NextRequest } from 'next/server';
import { getSessionIdFromCookie } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { applyRequestId } from '@/lib/api/request-id';

/**
 * Next.js middleware for the entire app.
 *
 * Runs on the Edge runtime (no Node.js APIs, no Prisma). Does:
 *
 * 1. **Request-id stamping (M15)** — every response (success, redirect,
 *    error) carries `x-request-id`. Inbound header echoed if valid;
 *    otherwise a fresh UUID generated via Web Crypto. Edge-safe.
 *
 * 2. **M32.6 setup wizard gate** — historically read the
 *    `ghc_setup_done=1` cookie directly. The cookie-only signal broke
 *    whenever a fresh dev:server started (no browser cookie) or whenever
 *    the cookie expired/cleared, even though the underlying DB was
 *    fully provisioned.
 *
 *    M32.6.5: the wizard's `lockSetupSubtask` now also persists
 *    `GHC_SETUP_DONE=1` to `.env`. Next.js's `loadEnvConfig` reads
 *    `.env` once at `bootServer()` time, so `process.env.GHC_SETUP_DONE`
 *    is `'1'` for every request after init has run — even on a fresh
 *    process with no browser cookie. Middleware reads BOTH signals:
 *
 *    - the cookie (per-browser, fast, set by the wizard on completion)
 *    - `process.env.GHC_SETUP_DONE === '1'` (process-wide, durable
 *      across server restarts because `.env` is loaded by Next's
 *      `loadEnvConfig` at boot)
 *
 *    Either signal satisfies the gate. This makes init one-shot — after
 *    completion the service runs without the wizard ever being
 *    re-entered, and the `ghc_setup_done` cookie is only a per-tab
 *    fallback (e.g. for browsers that arrived before init completed).
 *
 *    When `done=false`, non-`/init` requests redirect to `/init`.
 *    When `done=true`, the `/init` wizard bounces back to `/` (stale
 *    bookmark).
 *
 * 3. **`/admin/*` pages** — if no session cookie, redirect to `/login`.
 *    Cookie existence is NOT full session validation — expired/forged
 *    cookies pass middleware but fail at the page level (which calls
 *    the full `validateSession` from @/lib/auth/session).
 *
 * 4. **`/api/admin/*` non-GET** — require CSRF token (double-submit pattern:
 *    `ghc_csrf` cookie value must match `X-CSRF-Token` header). GETs
 *    are exempt (idempotent reads).
 *
 * CSRF failure body intentionally stays as `{error: 'csrf'}` (legacy
 * shape) — admin CSRF failures are not part of the M15 OpenAPI surface.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const path = req.nextUrl.pathname;

  // --- M28.bug12 / M32.6 / M32.6.5 setup wizard gate -----------------------
  // Two independent signals, either is sufficient:
  //   1. ghc_setup_done=1 cookie (per-browser; the wizard sets it at the
  //      end of step 3)
  //   2. process.env.GHC_SETUP_DONE === '1' (process-wide; written to
  //      .env by lockSetupSubtask, picked up by Next's loadEnvConfig
  //      at bootServer() time)
  //
  // The env signal is the durable one — it survives server restarts and
  // the absence of any browser cookie. The cookie is a per-tab fallback
  // that still works (and is needed by the backfill route at
  // /api/setup/backfill).
  const cookieSetupDone = req.cookies.get('ghc_setup_done')?.value === '1';
  const envSetupDone = process.env.GHC_SETUP_DONE === '1';
  const setupDone = cookieSetupDone || envSetupDone;
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
    //
    // We have to forward the pathname through request headers (not
    // response headers) so server components reading it via
    // `headers()` from next/headers actually see it. Setting it on the
    // response alone is a common pitfall — Next.js only propagates
    // request-side headers into the React tree.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-pathname', path);
    const res = NextResponse.next({ request: { headers: requestHeaders } });
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
    '/((?!_next|_next/static|_next/image|favicon.ico|api/setup/backfill).*)',
  ],
};