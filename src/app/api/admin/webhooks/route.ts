import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { createSubscription } from '@/lib/webhooks/db';
import { generateWebhookSecret } from '@/lib/webhooks/signer';

/**
 * POST /api/admin/webhooks
 *
 * Create a new webhook subscription. Body: `{ url, eventFilter }`.
 * Returns the new subscription row + the one-time signing secret.
 *
 * Admin-only. CSRF enforced by middleware for non-GET admin routes.
 */
export async function POST(req: Request): Promise<Response> {
  const user = await validateSession(req);
  if (!user) return new NextResponse(null, { status: 404 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'admin role required' }, { status: 403 });
  }
  if (user.status !== 'active') {
    return NextResponse.json({ error: 'account_disabled' }, { status: 403 });
  }

  let body: { url?: unknown; eventFilter?: unknown } = {};
  try {
    body = (await req.json()) as { url?: unknown; eventFilter?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (typeof body.url !== 'string' || !/^https?:\/\//.test(body.url)) {
    return NextResponse.json({ error: 'url must be http(s)://...' }, { status: 400 });
  }
  if (body.url.length > 500) {
    return NextResponse.json({ error: 'url too long (max 500)' }, { status: 400 });
  }
  if (!Array.isArray(body.eventFilter)) {
    return NextResponse.json({ error: 'eventFilter must be an array' }, { status: 400 });
  }
  if (!body.eventFilter.every((e) => typeof e === 'string')) {
    return NextResponse.json({ error: 'eventFilter entries must be strings' }, { status: 400 });
  }
  // Empty array → fail closed (no events). Caller likely meant `["*"]`.
  if (body.eventFilter.length === 0) {
    return NextResponse.json({ error: 'eventFilter cannot be empty (use ["*"] for all)' }, { status: 400 });
  }

  const eventFilter = body.eventFilter as string[];
  const secret = generateWebhookSecret();

  let row;
  try {
    row = await createSubscription({
      url: body.url,
      secret,
      eventFilter,
      createdBy: user.id,
    });
  } catch (e) {
    logger.error({ err: e }, 'create webhook subscription failed');
    return NextResponse.json({ error: 'create failed' }, { status: 500 });
  }

  return NextResponse.json({
    id: row.id.toString(),
    url: row.url,
    eventFilter: row.eventFilter,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    // The secret is shown exactly once. UI must display it inline
    // and warn the admin to save it before navigating away.
    secret,
  });
}