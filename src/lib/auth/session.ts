import type { User } from '@prisma/client';
import {
  createSession as dbCreateSession,
  findSessionById,
  invalidateSession as dbInvalidate,
  invalidateAllSessionsForUser,
} from '@/lib/db/sessions';
import { env } from '@/lib/config/env';

export const SESSION_COOKIE_NAME = 'ghc_admin_sid';

interface HeaderCarrier {
  headers: Headers;
}

interface RequestLike extends HeaderCarrier {
  cookies?: { get(name: string): { value: string } | undefined };
}

/**
 * Extract the session ID from the request's `ghc_admin_sid` cookie.
 *
 * Next.js 14 Request objects expose cookies via `req.cookies.get(name)`. We
 * duck-type the request to support both Request (Web API) and NextRequest.
 */
export function getSessionIdFromCookie(req: RequestLike): string | null {
  const fromCookie = req.cookies?.get(SESSION_COOKIE_NAME)?.value;
  if (fromCookie) return fromCookie;
  // Fallback: parse Cookie header manually (for routes that receive raw Request)
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE_NAME}=`));
  return match ? match.slice(SESSION_COOKIE_NAME.length + 1) : null;
}

/**
 * Validate the session for a request. Returns the active user, or null if:
 *   - No session cookie
 *   - Session expired / missing / user disabled
 *
 * Also performs sliding renewal on the server side (handled in findSessionById).
 */
export async function validateSession(req: RequestLike): Promise<User | null> {
  const id = getSessionIdFromCookie(req);
  if (!id) return null;
  const session = await findSessionById(id);
  return session?.user ?? null;
}

/**
 * Create a new session and set the cookie on the response.
 *
 * Returns the session ID and expiration time for caller convenience
 * (e.g., logging).
 */
export async function createSession(
  userId: bigint,
  res: HeaderCarrier,
  ip?: string,
): Promise<{ id: string; expiresAt: Date }> {
  const { id, expiresAt } = await dbCreateSession(userId, ip);
  setSessionCookie(res, id, expiresAt);
  return { id, expiresAt };
}

export function setSessionCookie(res: HeaderCarrier, sessionId: string, expiresAt: Date): void {
  res.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
}

export function clearSessionCookie(res: HeaderCarrier): void {
  res.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
}

/**
 * Logout: invalidate the session row AND clear the cookie. Atomic-feeling
 * from user perspective.
 */
export async function logout(req: RequestLike, res: HeaderCarrier): Promise<void> {
  const id = getSessionIdFromCookie(req);
  if (id) await dbInvalidate(id);
  clearSessionCookie(res);
}

// Re-export for convenience
export { invalidateAllSessionsForUser };
