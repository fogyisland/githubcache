import { NextResponse } from 'next/server';
import { issueCsrfToken, setCsrfCookie } from '@/lib/auth/csrf';

/**
 * Issue a new CSRF token. The token is set as the `ghc_csrf` cookie
 * (NOT httpOnly, so JS can read it to put in the X-CSRF-Token header).
 * The same value is returned in the body for client convenience.
 *
 * Idempotent: calling multiple times rotates the token. The previous token
 * (if any) is overwritten in the cookie jar.
 *
 * Used by:
 *   - GET /api/admin/auth/csrf on page mount (login page, admin dashboard)
 *   - Re-issued on successful login (rotation per OWASP CSRF cheatsheet)
 */
export async function GET(): Promise<Response> {
  const token = issueCsrfToken();
  const res = NextResponse.json({ csrfToken: token });
  setCsrfCookie(res, token);
  return res;
}
