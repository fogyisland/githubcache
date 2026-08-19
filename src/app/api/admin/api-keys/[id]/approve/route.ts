import { NextResponse } from 'next/server';
import { approveKey } from '@/lib/api-keys/workflow';
import { validateSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

interface Params {
  params: { id: string };
}

/**
 * POST /api/admin/api-keys/[id]/approve
 *
 * Session-authenticated (cookie-session). CSRF is enforced
 * by the middleware for all non-GET /api/admin/* requests.
 *
 * Response codes:
 *   200 — approved; body contains the one-time plaintext key
 *   400 — invalid id
 *   403 — session valid but account disabled
 *   404 — no/invalid session (deliberately not 401: hides endpoint existence)
 *   404 — key not found / already revoked
 */
export async function POST(req: Request, { params }: Params): Promise<Response> {
  const user = await validateSession(req);
  if (!user) {
    // Hide endpoint existence from unauthenticated callers
    return new NextResponse(null, { status: 404 });
  }
  if (user.status !== 'active') {
    return NextResponse.json({ error: 'account_disabled' }, { status: 403 });
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: { rateLimit?: number; dailyQuota?: number } = {};
  try {
    const raw: unknown = await req.json();
    if (raw !== null && typeof raw === 'object') {
      const obj = raw as { rateLimit?: unknown; dailyQuota?: unknown };
      const r = obj.rateLimit;
      const d = obj.dailyQuota;
      if (typeof r === 'number') body = { ...body, rateLimit: r };
      if (typeof d === 'number') body = { ...body, dailyQuota: d };
    }
  } catch {
    // empty body OK — defaults apply
  }

  try {
    const fwd = req.headers.get('x-forwarded-for');
    const result = await approveKey({
      id,
      ...body,
      actorUserId: user.id,
      ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
    });
    return NextResponse.json({
      id: String(result.row.id),
      name: result.row.name,
      status: result.row.status,
      plain: result.plain,
      keyPrefix: result.row.keyPrefix,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    logger.error({ err: e, id }, 'approve failed');
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
