import { NextResponse } from 'next/server';
import { revokeKey } from '@/lib/api-keys/workflow';
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
    return new NextResponse(null, { status: 404 });
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const actor = await devTokenActor();
  if (actor === null) {
    return NextResponse.json({ error: 'no admin user exists' }, { status: 500 });
  }

  try {
    const fwd = req.headers.get('x-forwarded-for');
    const row = await revokeKey({
      id,
      actorUserId: actor,
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
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
