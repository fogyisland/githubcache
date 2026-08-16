import { randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/config/env';

export const CSRF_COOKIE_NAME = 'ghc_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token'; // lowercase per HTTP/2 + Fetch spec

interface HeaderCarrier {
  headers: Headers;
}

interface RequestLike extends HeaderCarrier {
  cookies?: { get(name: string): { value: string } | undefined };
}

/**
 * Generate a new CSRF token: 32 random bytes encoded as hex (64 chars).
 * Tokens are NOT stored server-side; the double-submit pattern relies on
 * the client echoing the same value in header.
 */
export function issueCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Set the CSRF cookie (NOT httpOnly — JS must read it to echo in header).
 * SameSite=Lax + (in production) Secure. No Expires/Max-Age → session cookie.
 */
export function setCsrfCookie(res: HeaderCarrier, token: string): void {
  res.headers.append(
    'Set-Cookie',
    `${CSRF_COOKIE_NAME}=${token}; Path=/; SameSite=Lax${env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
}

/**
 * Clear the CSRF cookie (logout).
 */
export function clearCsrfCookie(res: HeaderCarrier): void {
  res.headers.append(
    'Set-Cookie',
    `${CSRF_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0${env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
}

/**
 * Extract the CSRF token from either the cookie OR the header. Returns null
 * if missing.
 */
function extractToken(req: RequestLike, from: 'cookie' | 'header'): string | null {
  if (from === 'cookie') {
    const fromCookie = req.cookies?.get(CSRF_COOKIE_NAME)?.value;
    if (fromCookie) return fromCookie;
    // Fallback to manual Cookie header parse
    const cookieHeader = req.headers.get('cookie');
    if (!cookieHeader) return null;
    const match = cookieHeader
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${CSRF_COOKIE_NAME}=`));
    return match ? match.slice(CSRF_COOKIE_NAME.length + 1) : null;
  }
  return req.headers.get(CSRF_HEADER_NAME);
}

/**
 * Verify CSRF protection: the token in the X-CSRF-Token header must match
 * the value in the ghc_csrf cookie, byte-for-byte.
 *
 * Returns false (never throws) for:
 *   - Missing cookie or header
 *   - Length mismatch
 *   - Different values
 *
 * Uses constant-time comparison to defeat timing attacks.
 */
export function verifyCsrf(req: RequestLike, headerToken: string | null): boolean {
  const cookieToken = extractToken(req, 'cookie');
  if (!cookieToken || !headerToken) return false;
  // Use constant-time comparison on UTF-8 bytes
  const a = new TextEncoder().encode(cookieToken);
  const b = new TextEncoder().encode(headerToken);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
