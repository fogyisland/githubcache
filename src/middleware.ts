import { NextResponse, type NextRequest } from 'next/server';
import { getSessionIdFromCookie } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';

/**
 * Next.js 14 middleware for admin routes.
 *
 * Runs on the Edge runtime (no Node.js APIs, no Prisma). Only does
 * lightweight checks:
 *
 * 1. /admin/* (pages): If no session cookie, redirect to /login.
 *    Cookie existence is NOT full session validation — expired/forged
 *    cookies pass middleware but fail at the page level (which calls
 *    the full `validateSession` from @/lib/auth/session).
 *
 * 2. /api/admin/* (non-GET): Require CSRF token (double-submit pattern:
 *    `ghc_csrf` cookie value must match `X-CSRF-Token` header).
 *
 * GET requests to /api/admin/* are not CSRF-protected (idempotent reads).
 *
 * Note: GET /api/admin/auth/csrf is exempt by virtue of being a GET, so the
 * client can fetch a CSRF token before logging in.
 *
 * Matcher excludes /api/admin/auth/csrf? No — it's a GET, so CSRF is exempt.
 * Login (POST /api/admin/auth/login) IS CSRF-protected — middleware enforces.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const path = req.nextUrl.pathname;

  // Page-level admin auth: redirect to /login if no session cookie
  if (path.startsWith('/admin')) {
    const sessionId = getSessionIdFromCookie(req);
    if (!sessionId) {
      const loginUrl = new URL('/login', req.url);
      return NextResponse.redirect(loginUrl);
    }
    // Cookie exists — let the page render. Page-level validation will
    // do the DB lookup and handle expired/forged cookies.
    return NextResponse.next();
  }

  // API-level CSRF: block non-GET /api/admin/* without valid CSRF
  if (path.startsWith('/api/admin') && req.method !== 'GET') {
    const headerToken = req.headers.get('x-csrf-token');
    if (!verifyCsrf(req, headerToken)) {
      return NextResponse.json({ error: 'csrf' }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};