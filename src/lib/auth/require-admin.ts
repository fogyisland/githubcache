import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { validateSession, getSessionIdFromCookie } from '@/lib/auth/session';
import { findSessionById } from '@/lib/db/sessions';
import { apiError } from '@/lib/api/errors';
import type { User } from '@prisma/client';

/**
 * M28 — shared admin-only auth gate.
 *
 * Replaces the 12-line cookie/validateSession/redirect boilerplate
 * that was copy-pasted into every admin page. Three of the pages
 * (api-settings, email, database/operations) also needed the
 * `x-pathname` header for tab highlighting, so we return that too
 * for callers that care.
 *
 * Usage in a server component:
 * ```ts
 * export default async function AdminXPage() {
 *   await requireAdmin();
 *   // ... rest of page
 * }
 *
 *   // or, with pathname for tab nav:
 *   const { pathname } = await requireAdmin();
 * ```
 *
 * Behavior:
 *  - No session → redirect('/login')
 *  - Session but role !== 'admin' → redirect('/admin')
 *  - Returns the User + the request pathname (for tabs / active-link)
 */
export async function requireAdmin(): Promise<{ user: User; pathname: string }> {
  const cookieStore = await cookies();
  const cookieMap = Object.fromEntries(
    cookieStore.getAll().map((c) => [c.name, c.value]),
  );
  const user = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!user) {
    redirect('/login');
  }
  if (user.role !== 'admin') {
    redirect('/admin');
  }
  const headerStore = await headers();
  const pathname = headerStore.get('x-pathname') ?? '/admin';
  return { user, pathname };
}

// ===== Step 2: route handler variant =====

interface AdminRouteAuthResult {
  ok: true;
  user: User;
}
interface AdminRouteAuthFail {
  ok: false;
  response: Response;
}

/**
 * Route-handler variant of requireAdmin().
 *
 * Same semantics as the page variant (requireAdmin) but:
 *  - Takes a Request / NextRequest instead of calling cookies()/headers()
 *    (route handlers get the request, not server-component cookie APIs).
 *  - Returns Response on failure instead of redirecting — routes must
 *    reply with JSON, not navigate.
 *
 * Returns { ok: true, user } on success; { ok: false, response } on
 * 401 (missing/expired session) or 403 (non-admin role).
 *
 * Usage in a route handler:
 * ```ts
 * export async function PATCH(req: NextRequest, { params }) {
 *   const auth = await requireAdminFromRequest(req);
 *   if (!auth.ok) return auth.response;
 *   const { user } = auth;
 *   // ...rest
 * }
 * ```
 */
export async function requireAdminFromRequest(
  req: Request,
): Promise<AdminRouteAuthResult | AdminRouteAuthFail> {
  const id = getSessionIdFromCookie(req);
  if (!id) {
    return { ok: false, response: apiError('unauthorized', 'unauthorized', {}, req) };
  }
  const session = await findSessionById(id);
  if (!session) {
    return { ok: false, response: apiError('unauthorized', 'unauthorized', {}, req) };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, response: apiError('forbidden', 'forbidden', {}, req) };
  }
  return { ok: true, user: session.user };
}
