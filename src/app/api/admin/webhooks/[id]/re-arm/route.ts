import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/auth/session';
import { reArmSubscription } from '@/lib/webhooks/db';

interface Params {
  params: { id: string };
}

/** POST /api/admin/webhooks/[id]/re-arm — re-enable after a dead-letter
 *  or manual disable. Admin-only. */
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

  const row = await reArmSubscription(id);
  return NextResponse.json({ id: row.id.toString(), active: row.active });
}