import { NextResponse } from 'next/server';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { prisma } from '@/lib/db/client';
import { writeAudit } from '@/lib/audit/writer';
import { apiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/refresh-jobs/[id]/retry
 *
 * Admin only. Resets a refresh_job row to 'pending' so the next scheduler
 * tick will pick it up. We only act on rows whose current status is
 * 'failed' or 'in_progress' (stuck) — re-queuing an already-pending row
 * is a no-op and is rejected to make double-clicks harmless.
 *
 * Body: { csrf: string } (adminFetch injects the header too, but the
 * route accepts the header OR the body field for symmetry with M7.1).
 *
 * Response codes:
 *   200 — { ok: true, jobId }
 *   400 — invalid id
 *   403 — not admin / invalid CSRF
 *   404 — refresh_job not found
 *   409 — job is already pending (operator should wait)
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'forbidden', {}, req);
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return apiError('bad_request', 'invalid id', {}, req);
  }

  const csrfFromHeader = req.headers.get('x-csrf-token');
  let body: unknown = null;
  try {
    body = await req.clone().json();
  } catch {
    body = null;
  }
  const csrfFromBody =
    typeof body === 'object' && body !== null && 'csrf' in body
      ? (body as { csrf?: unknown }).csrf
      : undefined;
  const csrf = csrfFromHeader ?? (typeof csrfFromBody === 'string' ? csrfFromBody : null);
  if (!csrf || !verifyCsrf(req, csrf)) {
    return apiError('forbidden', 'invalid csrf', {}, req);
  }

  const existing = await prisma.refreshJob.findUnique({ where: { id } });
  if (!existing) {
    return apiError('not_found', 'not found', {}, req);
  }
  if (existing.status === 'pending') {
    return apiError('conflict', 'job already pending', {}, req);
  }

  try {
    const updated = await prisma.refreshJob.update({
      where: { id },
      data: {
        status: 'pending',
        scheduledFor: new Date(),
        lastError: null,
        lockedUntil: null,
      },
    });

    const fwd = req.headers.get('x-forwarded-for');
    void writeAudit({
      action: 'retry_refresh_job',
      targetType: 'refresh_job',
      targetId: String(id),
      metadata: {
        repositoryId: String(updated.repositoryId),
        previousStatus: existing.status,
      },
      actorUserId: user.id,
      ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
    });

    return NextResponse.json({ ok: true, jobId: String(id) });
  } catch (e: unknown) {
    logger.error({ err: e, id: id.toString() }, 'retry refresh_job failed');
    return apiError('internal_error', 'retry failed', {}, req);
  }
}
