import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/auth/session';
import { rotateSubscriptionSecret } from '@/lib/webhooks/db';
import { generateWebhookSecret } from '@/lib/webhooks/signer';
import { apiError } from '@/lib/api/errors';

interface Params {
  params: { id: string };
}

/** POST /api/admin/webhooks/[id]/rotate-secret — generate a new signing
 *  secret and return it once. Admin-only. */
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

  const newSecret = generateWebhookSecret();
  const row = await rotateSubscriptionSecret(id, newSecret);
  return NextResponse.json({
    id: row.id.toString(),
    secret: newSecret,
  });
}