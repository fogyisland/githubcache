import { NextResponse } from 'next/server';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { prisma } from '@/lib/db/client';
import { writeAudit } from '@/lib/audit/writer';
import { apiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/refresh-jobs/[id]/cancel
 *
 * Admin only. Sets a refresh_job row to 'failed' with a synthetic
 * `last_error` so it leaves the pending queue and stops blocking
 * progress on its repository. We refuse to mutate already-terminal rows
 * (done/failed) — once a job lands there, it stays there.
 *
 * Body / CSRF: see `/retry`.
 *
 * Response codes:
 *   200 — { ok: true, jobId }
 *   400 — invalid id
 *   403 — not admin / invalid CSRF
 *   404 — refresh_job not found
 *   409 — job is in a terminal status (already done or failed)
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
  if (existing.status === 'done' || existing.status === 'failed') {
    return apiError('conflict', 'job is already terminal', {}, req);
  }

  try {
    const updated = await prisma.refreshJob.update({
      where: { id },
      data: {
        status: 'failed',
        lastError: 'cancelled by admin',
        lockedUntil: null,
      },
    });

    const fwd = req.headers.get('x-forwarded-for');
    void writeAudit({
      action: 'cancel_refresh_job',
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
    logger.error({ err: e, id: id.toString() }, 'cancel refresh_job failed');
    return apiError('internal_error', 'cancel failed', {}, req);
  }
}
