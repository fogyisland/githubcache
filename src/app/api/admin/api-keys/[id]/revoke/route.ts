import { NextResponse } from 'next/server';
import { revokeKey } from '@/lib/api-keys/workflow';
import { validateSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { apiError } from '@/lib/api/errors';

interface Params {
  params: { id: string };
}

/**
 * POST /api/admin/api-keys/[id]/revoke
 *
 * Session-authenticated (cookie-session). CSRF is enforced
 * by the middleware for all non-GET /api/admin/* requests.
 *
 * Response codes:
 *   200 — revoked
 *   400 — invalid id
 *   403 — session valid but account disabled
 *   404 — no/invalid session (deliberately not 401: hides endpoint existence)
 *   404 — key not found
 */
export async function POST(req: Request, { params }: Params): Promise<Response> {
  const user = await validateSession(req);
  if (!user) {
    // Hide endpoint existence from unauthenticated callers
    return new NextResponse(null, { status: 404 });
  }
  if (user.status !== 'active') {
    return apiError('forbidden', 'account_disabled', {}, req);
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return apiError('bad_request', 'invalid id', {}, req);
  }

  try {
    const fwd = req.headers.get('x-forwarded-for');
    const row = await revokeKey({
      id,
      actorUserId: user.id,
      ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
    });
    return NextResponse.json({
      id: String(row.id),
      status: row.status,
      revokedAt: row.revokedAt,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    logger.error({ err: e, id }, 'revoke failed');
    return apiError('not_found', msg, {}, req);
  }
}
