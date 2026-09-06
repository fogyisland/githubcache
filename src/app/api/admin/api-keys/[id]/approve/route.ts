import { NextResponse } from 'next/server';
import { approveKey } from '@/lib/api-keys/workflow';
import { validateSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { apiError } from '@/lib/api/errors';
import { sendApiKeyApprovedEmail } from '@/lib/email/triggers/api-key-approved';
import { prisma } from '@/lib/db/client';

interface Params {
  params: { id: string };
}

/**
 * POST /api/admin/api-keys/[id]/approve
 *
 * Session-authenticated (cookie-session). CSRF is enforced
 * by the middleware for all non-GET /api/admin/* requests.
 *
 * Response codes:
 *   200 — approved; body contains the one-time plaintext key + emailSent
 *   400 — invalid id
 *   403 — session valid but account disabled
 *   404 — no/invalid session (deliberately not 401: hides endpoint existence)
 *   404 — key not found / already revoked
 *
 * M25: when SMTP is configured, the plaintext key is also emailed to
 * the key owner. `emailSent` in the response reflects the outcome.
 * The plaintext key is ALWAYS returned in the response body so the
 * approving admin can copy it out of band even when SMTP fails.
 */
export async function POST(req: Request, { params }: Params): Promise<Response> {
  const user = await validateSession(req);
  if (!user) {
    // Hide endpoint existence from unauthenticated callers
    return new NextResponse(null, { status: 404 });
  }
  if (user.status !== 'active') {
    return apiError('forbidden', 'account_disabled', {}, req);
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return apiError('bad_request', 'invalid id', {}, req);
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

  try {
    const fwd = req.headers.get('x-forwarded-for');
    const result = await approveKey({
      id,
      ...body,
      actorUserId: user.id,
      ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
    });

    // M25 — email the plaintext key to the owner when SMTP is configured.
    let emailSent = false;
    try {
      const keyOwner = await prisma.user.findUnique({ where: { id: result.row.userId } });
      if (keyOwner) {
        const sendResult = await sendApiKeyApprovedEmail(
          keyOwner,
          result.plain,
          result.row.name,
        );
        emailSent = sendResult.ok;
        if (!sendResult.ok) {
          logger.info(
            { keyId: String(result.row.id), error: sendResult.error },
            'api-key email not sent (likely not_configured)',
          );
        }
      }
    } catch (e: unknown) {
      logger.error(
        { err: e, keyId: String(result.row.id) },
        'api-key email send threw',
      );
    }

    return NextResponse.json({
      id: String(result.row.id),
      name: result.row.name,
      status: result.row.status,
      plain: result.plain,
      keyPrefix: result.row.keyPrefix,
      emailSent,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    logger.error({ err: e, id }, 'approve failed');
    return apiError('not_found', msg, {}, req);
  }
}
