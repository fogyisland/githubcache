import { NextResponse } from 'next/server';
import { revokeKey } from '@/lib/api-keys/workflow';
import { validateDevToken } from '@/lib/dev-token';
import { logger } from '@/lib/logger';

interface Params {
  params: { id: string };
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

  try {
    const fwd = req.headers.get('x-forwarded-for');
    const row = await revokeKey({
      id,
      actorUserId: BigInt(1),
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
