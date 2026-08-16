import { NextResponse } from 'next/server';
import { approveKey } from '@/lib/api-keys/workflow';
import { validateDevToken } from '@/lib/dev-token';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';

interface Params {
  params: { id: string };
}

/**
 * Resolve the actor for dev-token admin actions. M3 has no session, so we
 * pick the first active admin user. M6 replaces this with a cookie-session
 * lookup. Returns null when no admin user exists.
 */
async function devTokenActor(): Promise<bigint | null> {
  const u = await prisma.user.findFirst({
    where: { role: 'admin', status: 'active' },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return u?.id ?? null;
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
  if (!validateDevToken(req)) {
    // Hide endpoint existence from unauth callers
    return new NextResponse(null, { status: 404 });
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

  const actor = await devTokenActor();
  if (actor === null) {
    return NextResponse.json({ error: 'no admin user exists' }, { status: 500 });
  }

  try {
    const fwd = req.headers.get('x-forwarded-for');
    const result = await approveKey({
      id,
      ...body,
      actorUserId: actor,
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
