import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/auth/session';
import { retryDelivery } from '@/lib/webhooks/db';

interface Params {
  params: { id: string };
}

/** POST /api/admin/webhooks/deliveries/[id]/retry — reset a dead/failed
 *  delivery back to pending so the worker picks it up immediately.
 *  Admin-only. */
export async function POST(req: Request, { params }: Params): Promise<Response> {
  const user = await validateSession(req);
  if (!user) return new NextResponse(null, { status: 404 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'admin role required' }, { status: 403 });
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const row = await retryDelivery(id, new Date());
  return NextResponse.json({
    id: row.id.toString(),
    status: row.status,
    nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
  });
}