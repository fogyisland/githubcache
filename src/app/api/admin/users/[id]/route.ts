import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateSession } from '@/lib/auth/session';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { verifyCsrf } from '@/lib/auth/csrf';
import { getUserById, updateUserStatus } from '@/lib/db/users';
import { invalidateAllSessionsForUser } from '@/lib/db/sessions';
import { writeAudit } from '@/lib/audit/writer';
import { apiError } from '@/lib/api/errors';

const PatchBody = z.object({
  status: z.enum(['active', 'disabled']),
  csrf: z.string().min(1),
});

interface AuthOk {
  ok: true;
  user: { id: bigint; role: string };
}
interface AuthFail {
  ok: false;
  res: Response;
}

/**
 * Verify the requester is an authenticated admin.
 *
 * The cookieMap / validateSession pattern is the same as in /api/admin/users/invite.
 */
async function requireAdmin(req: Request): Promise<AuthOk | AuthFail> {
  const user = await validateSession({
    headers: req.headers,
    cookies: cookiesFromRequest(req),
  });
  if (!user || user.role !== 'admin') {
    return {
      ok: false,
      res: apiError('forbidden', 'forbidden', {}, req),
    };
  }
  return { ok: true, user };
}

/**
 * PATCH /api/admin/users/[id]
 *
 * Body: { status: 'active' | 'disabled', csrf }
 *
 * Admin-only. Flips the user's status. Does NOT invalidate sessions —
 * the `DELETE` handler below is the explicit "logout everywhere" action.
 * Disabling a user alone lets existing sessions time out naturally (they
 * are deleted on next `findSessionById` because the user's status is no
 * longer 'active').
 *
 * Response codes:
 *   200 — { ok: true }
 *   400 — invalid id or body
 *   403 — not admin / invalid CSRF
 *   404 — user not found
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return apiError('bad_request', 'invalid id', {}, req);
  }
  const target = await getUserById(id);
  if (!target) {
    return apiError('not_found', 'not found', {}, req);
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return apiError('bad_request', 'invalid body', {}, req);
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return apiError('forbidden', 'invalid csrf', {}, req);
  }

  // M26.x — block self-disable. An admin who disables their own account
  // gets locked out immediately (findSessionById deletes the session on
  // next request) and there is no admin self-recovery path. Re-enable
  // requires another admin or a direct SQL fix. The UI hides the button
  // too; this is defense-in-depth.
  if (parsed.data.status === 'disabled' && target.id === auth.user.id) {
    return apiError('bad_request', 'cannot disable self', {}, req);
  }

  await updateUserStatus(id, parsed.data.status);

  const fwdPatch = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: parsed.data.status === 'disabled' ? 'disable_user' : 'enable_user',
    targetType: 'user',
    targetId: String(id),
    metadata: { previousStatus: target.status, newStatus: parsed.data.status },
    actorUserId: auth.user.id,
    ...(fwdPatch !== null && fwdPatch !== '' ? { ip: fwdPatch } : {}),
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/users/[id]
 *
 * Admin-only. "Logout everywhere" — invalidates ALL sessions for the
 * target user. Does NOT delete the user row (soft semantics; spec §9.1
 * uses this for force-logout, not removal).
 *
 * CSRF may come from the X-CSRF-Token header OR the JSON body — accept
 * either to keep client flexibility (DELETE bodies are non-standard but
 * simpler for fetch callers).
 *
 * No self-delete guard: an admin can hit this on themselves; the
 * subsequent session validation will fail and redirect them to /login.
 *
 * Response codes:
 *   200 — { ok: true, sessionsInvalidated: number }
 *   400 — invalid id
 *   403 — not admin / invalid CSRF
 *   404 — user not found
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return apiError('bad_request', 'invalid id', {}, req);
  }
  const target = await getUserById(id);
  if (!target) {
    return apiError('not_found', 'not found', {}, req);
  }

  // DELETE may carry CSRF in body OR header — accept either.
  const csrfFromHeader = req.headers.get('x-csrf-token');
  let body: unknown = null;
  try {
    body = await req.clone().json();
  } catch {
    body = null;
  }
  const csrfFromBody =
    typeof body === 'object' && body !== null && 'csrf' in body
      ? (body as { csrf?: unknown }).csrf
      : undefined;
  const csrf = csrfFromHeader ?? (typeof csrfFromBody === 'string' ? csrfFromBody : null);
  if (!csrf || !verifyCsrf(req, csrf)) {
    return apiError('forbidden', 'invalid csrf', {}, req);
  }

  // Logout everywhere: invalidate all sessions for this user.
  const invalidated = await invalidateAllSessionsForUser(id);

  const fwdDel = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: 'logout_all_sessions',
    targetType: 'user',
    targetId: String(id),
    metadata: { sessionsInvalidated: invalidated },
    actorUserId: auth.user.id,
    ...(fwdDel !== null && fwdDel !== '' ? { ip: fwdDel } : {}),
  });

  return NextResponse.json({ ok: true, sessionsInvalidated: invalidated });
}
