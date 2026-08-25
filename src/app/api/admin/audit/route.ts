import { NextResponse } from 'next/server';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { queryAuditLog, getActorEmails } from '@/lib/db/audit';

const LIMIT_MIN = 1;
const LIMIT_MAX = 200;
const LIMIT_DEFAULT = 50;

/**
 * GET /api/admin/audit
 *
 * Query params (all optional except for pagination defaults):
 *   action        — string (exact match)
 *   actorUserId   — BigInt as string (exact match)
 *   targetType    — string (exact match)
 *   from          — ISO date (createdAt >= from)
 *   to            — ISO date (createdAt < to)
 *   limit         — 1..200 (default 50)
 *   offset        — non-negative integer (default 0)
 *
 * Admin only per spec §9.1.
 *
 * Response codes:
 *   200 — { rows, total, limit, offset }
 *   400 — invalid params
 *   403 — not admin
 */
export async function GET(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const params = url.searchParams;

  let limit = Number(params.get('limit') ?? LIMIT_DEFAULT);
  if (!Number.isFinite(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX) {
    return NextResponse.json({ error: 'invalid limit' }, { status: 400 });
  }
  let offset = Number(params.get('offset') ?? 0);
  if (!Number.isFinite(offset) || offset < 0 || !Number.isInteger(offset)) {
    return NextResponse.json({ error: 'invalid offset' }, { status: 400 });
  }

  let actorUserId: bigint | undefined;
  const actorParam = params.get('actorUserId');
  if (actorParam) {
    try {
      actorUserId = BigInt(actorParam);
    } catch {
      return NextResponse.json({ error: 'invalid actorUserId' }, { status: 400 });
    }
  }

  let from: Date | undefined;
  const fromParam = params.get('from');
  if (fromParam) {
    const d = new Date(fromParam);
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: 'invalid from' }, { status: 400 });
    }
    from = d;
  }

  let to: Date | undefined;
  const toParam = params.get('to');
  if (toParam) {
    const d = new Date(toParam);
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: 'invalid to' }, { status: 400 });
    }
    to = d;
  }

  const { rows, total } = await queryAuditLog({
    ...(params.get('action') ? { action: params.get('action')! } : {}),
    ...(actorUserId !== undefined ? { actorUserId } : {}),
    ...(params.get('targetType') ? { targetType: params.get('targetType')! } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    limit,
    offset,
  });

  const actorIds = [
    ...new Set(rows.map((r) => r.actorUserId).filter((id): id is bigint => id !== null)),
  ];
  const emails = await getActorEmails(actorIds);

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      id: r.id.toString(),
      actorUserId: r.actorUserId?.toString() ?? null,
      actorEmail: r.actorUserId ? (emails.get(r.actorUserId) ?? null) : null,
    })),
    total,
    limit,
    offset,
  });
}
