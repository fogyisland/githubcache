import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { updateTokenStatus, deleteTokenById, getTokenById } from '@/lib/db/github-tokens';
import { addTokenToPool, removeTokenFromPool } from '@/lib/github/pool';
import { writeAudit } from '@/lib/audit/writer';
import { apiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

const PatchBody = z.object({
  status: z.enum(['active', 'disabled']),
  csrf: z.string().min(1),
});

/**
 * PATCH /api/admin/github-tokens/[id]
 *
 * Admin-only. Flips the token status between 'active' and 'disabled'.
 * Audits with `enable_token` or `disable_token`. Status changes are
 * mirrored into the in-memory pool immediately (no restart required).
 * Re-enabling a legacy row with no raw token is a no-op in the pool.
 *
 * Response codes:
 *   200 — { ok: true }
 *   400 — invalid id / invalid body
 *   403 — not admin / invalid CSRF
 *   404 — token not found
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'forbidden', {}, req);
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return apiError('bad_request', 'invalid id', {}, req);
  }
  const target = await getTokenById(id);
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

  const before = target.status;
  await updateTokenStatus(id, parsed.data.status);

  if (parsed.data.status === 'disabled') {
    removeTokenFromPool(id);
  } else {
    // re-enable: re-fetch the row and put it back in the pool
    const refreshed = await getTokenById(id);
    if (refreshed) {
      try {
        addTokenToPool(refreshed);
      } catch (e) {
        logger.error({ err: e, id: id.toString() }, 'failed to re-add token to pool on enable');
      }
    }
  }

  const fwd = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: parsed.data.status === 'disabled' ? 'disable_token' : 'enable_token',
    targetType: 'github_token',
    targetId: String(id),
    metadata: { before, after: parsed.data.status },
    actorUserId: user.id,
    ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/github-tokens/[id]
 *
 * Admin-only. Hard-deletes the DB row and removes the token from the
 * in-memory pool immediately. Audits `delete_token` with label +
 * first4/last4 (NOT the hash).
 *
 * CSRF may come from header or body — accept either (per M7.1 pattern).
 *
 * Response codes:
 *   200 — { ok: true }
 *   400 — invalid id
 *   403 — not admin / invalid CSRF
 *   404 — token not found
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'forbidden', {}, req);
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return apiError('bad_request', 'invalid id', {}, req);
  }
  const target = await getTokenById(id);
  if (!target) {
    return apiError('not_found', 'not found', {}, req);
  }

  // DELETE: CSRF can be in header OR body (per M7.1 pattern)
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

  await deleteTokenById(id);
  removeTokenFromPool(id);

  const fwd = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: 'delete_token',
    targetType: 'github_token',
    targetId: String(id),
    metadata: { label: target.label, first4: target.tokenFirst4, last4: target.tokenLast4 },
    actorUserId: user.id,
    ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
  });

  return NextResponse.json({ ok: true });
}
