import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { createSubscription } from '@/lib/webhooks/db';
import { generateWebhookSecret } from '@/lib/webhooks/signer';
import { apiError } from '@/lib/api/errors';

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
    return apiError('forbidden', 'admin role required', {}, req);
  }
  if (user.status !== 'active') {
    return apiError('forbidden', 'account_disabled', {}, req);
  }

  let body: { url?: unknown; eventFilter?: unknown } = {};
  try {
    body = (await req.json()) as { url?: unknown; eventFilter?: unknown };
  } catch {
    return apiError('bad_request', 'invalid JSON body', {}, req);
  }

  if (typeof body.url !== 'string' || !/^https?:\/\//.test(body.url)) {
    return apiError('bad_request', 'url must be http(s)://...', {}, req);
  }
  if (body.url.length > 500) {
    return apiError('bad_request', 'url too long (max 500)', {}, req);
  }
  if (!Array.isArray(body.eventFilter)) {
    return apiError('bad_request', 'eventFilter must be an array', {}, req);
  }
  if (!body.eventFilter.every((e) => typeof e === 'string')) {
    return apiError('bad_request', 'eventFilter entries must be strings', {}, req);
  }
  // Empty array → fail closed (no events). Caller likely meant `["*"]`.
  if (body.eventFilter.length === 0) {
    return apiError('bad_request', 'eventFilter cannot be empty (use ["*"] for all)', {}, req);
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
    return apiError('internal_error', 'create failed', {}, req);
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