import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/auth/session';
import { retryDelivery } from '@/lib/webhooks/db';
import { apiError } from '@/lib/api/errors';

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
    return apiError('forbidden', 'admin role required', {}, req);
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return apiError('bad_request', 'invalid id', {}, req);
  }

  const row = await retryDelivery(id, new Date());
  return NextResponse.json({
    id: row.id.toString(),
    status: row.status,
    nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
  });
}