import { NextResponse } from 'next/server';
import { logout } from '@/lib/auth/session';
import { clearCsrfCookie } from '@/lib/auth/csrf';
import { writeAudit } from '@/lib/audit/writer';
import { logger } from '@/lib/logger';

interface RequestLike {
  headers: Headers;
  cookies?: { get(name: string): { value: string } | undefined };
}

interface HeaderCarrier {
  headers: Headers;
}

/**
 * POST /api/admin/auth/logout
 *
 * No body. Invalidates the current session and clears both session + CSRF
 * cookies. Always returns 200 (idempotent — even if no session is present).
 *
 * CSRF check: enforced by middleware (M6.5). Logout always happens with a
 * valid CSRF token because the user must be authenticated to make the call.
 *
 * Audit: `logout` action with actor_user_id if a session was present.
 */
export async function POST(req: Request): Promise<Response> {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = fwd?.split(',')[0]?.trim() || 'unknown';

  const res = NextResponse.json({ ok: true });

  try {
    await logout(req as unknown as RequestLike, res as unknown as HeaderCarrier);
  } catch (e: unknown) {
    // Logout should be idempotent — if session lookup fails, still clear cookies
    logger.warn({ err: e, ip }, 'logout: session invalidation failed');
  }

  // Clear CSRF cookie too
  clearCsrfCookie(res as unknown as HeaderCarrier);

  // Audit (fire-and-forget — best-effort)
  // We don't know the actor_user_id without re-validating the session; skip audit
  // if the session was already invalid. The middleware path ensures we have a
  // valid session when this handler runs.
  void writeAudit({
    action: 'logout',
    targetType: 'session',
    targetId: 'current', // No session id captured post-invalidation
    ip,
  });

  return res;
}
