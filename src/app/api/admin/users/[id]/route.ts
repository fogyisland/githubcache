import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { getUserById, updateUserStatus } from '@/lib/db/users';
import { invalidateAllSessionsForUser } from '@/lib/db/sessions';
import { writeAudit } from '@/lib/audit/writer';

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
 * Build a `{get}` adapter for `validateSession` from the raw `Cookie`
 * header — see /api/admin/users/invite/route.ts for the rationale.
 */
function cookiesFromRequest(req: Request): {
  get(name: string): { value: string } | undefined;
} {
  const header = req.headers.get('cookie') ?? '';
  const map: Record<string, string> = {};
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq);
    const v = trimmed.slice(eq + 1);
    if (!(k in map)) map[k] = v;
  }
  return {
    get: (name: string): { value: string } | undefined =>
      map[name] !== undefined ? { value: map[name]! } : undefined,
  };
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
      res: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
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
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const target = await getUserById(id);
  if (!target) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return NextResponse.json({ error: 'invalid csrf' }, { status: 403 });
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
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const target = await getUserById(id);
  if (!target) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
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
    return NextResponse.json({ error: 'invalid csrf' }, { status: 403 });
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
