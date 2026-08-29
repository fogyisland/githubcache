import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/auth/session';
import { disableSubscription } from '@/lib/webhooks/db';
import { apiError } from '@/lib/api/errors';

interface Params {
  params: { id: string };
}

/** POST /api/admin/webhooks/[id]/disable — admin-only. */
export async function POST(req: Request, { params }: Params): Promise<Response> {
  const user = await validateSession(req);
  if (!user) return new NextResponse(null, { status: 404 });
  if (user.role !== 'admin') {
    return apiError('forbidden', 'admin role required', {}, req);
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return apiError('bad_request', 'invalid id', {}, req);
  }

  const row = await disableSubscription(id);
  return NextResponse.json({ id: row.id.toString(), active: row.active });
}