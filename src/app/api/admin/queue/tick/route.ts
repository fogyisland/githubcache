import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { writeAudit } from '@/lib/audit/writer';
import { runTick } from '@/lib/scheduler/tick';
import { apiError } from '@/lib/api/errors';

const Body = z.object({
  csrf: z.string().min(1),
});

/**
 * POST /api/admin/queue/tick
 *
 * Body: { csrf: string }
 *
 * Admin only (per M20.7 spec).
 *
 * Manually runs a single scheduler tick — claims up to SCHEDULER_BATCH_SIZE
 * pending jobs and processes them concurrently (returning the same
 * TickResult as the auto-tick). The background scheduler ticks every
 * SCHEDULER_TICK_MS (default 1000ms), so this endpoint is a "I want to
 * see the queue drain now" trigger for the /admin/queue page.
 *
 * Returns:
 *   200 — { ok: true, claimed, done, pending, failed }
 *   400 — invalid body / missing csrf
 *   403 — not admin / invalid csrf
 *
 * Audit: 'manual_scheduler_tick' (targetType=system, metadata={...tick}).
 */
export async function POST(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'forbidden', {}, req);
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return apiError('bad_request', 'invalid body', {}, req);
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return apiError('forbidden', 'invalid csrf', {}, req);
  }

  const fwd = req.headers.get('x-forwarded-for');
  const result = await runTick();
  void writeAudit({
    action: 'manual_scheduler_tick',
    targetType: 'system',
    targetId: 'scheduler',
    metadata: {
      claimed: result.claimed,
      done: result.done,
      pending: result.pending,
      failed: result.failed,
    },
    actorUserId: user.id,
    ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
  });

  return NextResponse.json({ ok: true, ...result });
}