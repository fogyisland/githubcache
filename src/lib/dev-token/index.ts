import { env } from '@/lib/config/env';

/**
 * Validates the X-Admin-Dev-Token header against env.ADMIN_DEV_TOKEN.
 *
 * Production-safe: returns false unconditionally when NODE_ENV === 'production'.
 * This module is TEMPORARY (deleted in M6 when cookie-session auth lands).
 * Do not extend with new admin auth logic — M6 will replace this with a proper
 * session-cookie-based admin auth.
 */
export function validateDevToken(req: Request): boolean {
  if (env.NODE_ENV === 'production') return false;
  const headerToken = req.headers.get('x-admin-dev-token');
  if (!headerToken) return false;
  return headerToken === env.ADMIN_DEV_TOKEN;
}
