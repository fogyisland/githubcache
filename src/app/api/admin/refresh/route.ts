import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { writeAudit } from '@/lib/audit/writer';
import { enqueueManualRefresh } from '@/lib/db/refresh-jobs';
import { pause, resume } from '@/lib/scheduler';
import { prisma } from '@/lib/db/client';

const Body = z.object({
  action: z.enum(['trigger', 'pause', 'resume']),
  repoId: z.string().optional(),
  csrf: z.string().min(1),
});

/**
 * POST /api/admin/refresh
 *
 * Body: { action: 'trigger' | 'pause' | 'resume', repoId?: string, csrf: string }
 *
 * Admin only per spec §9.1.
 *
 * - `trigger`: enqueues a high-priority (priority=10) refresh_jobs row for
 *   the given repoId. Returns { ok, jobId }. 400 if repoId missing/invalid,
 *   404 if the repo doesn't exist.
 * - `pause`: pauses the scheduler (process-local flag). Idempotent.
 * - `resume`: resumes the scheduler. Idempotent.
 *
 * Audit writes (fire-and-forget, never awaited):
 *   - trigger    → 'manual_refresh_trigger' (targetType=repository)
 *   - pause      → 'scheduler_paused'        (targetType=system)
 *   - resume     → 'scheduler_resumed'       (targetType=system)
 *
 * Response codes:
 *   200 — { ok, ...action-specific }
 *   400 — invalid body or missing/invalid repoId for trigger
 *   403 — not admin / invalid CSRF
 *   404 — repository not found (trigger only)
 */
export async function POST(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return NextResponse.json({ error: 'invalid csrf' }, { status: 403 });
  }

  const fwd = req.headers.get('x-forwarded-for');

  if (parsed.data.action === 'pause') {
    pause();
    void writeAudit({
      action: 'scheduler_paused',
      targetType: 'system',
      targetId: 'scheduler',
      metadata: { pausedAt: new Date().toISOString() },
      actorUserId: user.id,
      ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
    });
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === 'resume') {
    resume();
    void writeAudit({
      action: 'scheduler_resumed',
      targetType: 'system',
      targetId: 'scheduler',
      metadata: { resumedAt: new Date().toISOString() },
      actorUserId: user.id,
      ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
    });
    return NextResponse.json({ ok: true });
  }

  // action === 'trigger'
  if (!parsed.data.repoId) {
    return NextResponse.json({ error: 'repoId required' }, { status: 400 });
  }
  let repoId: bigint;
  try {
    repoId = BigInt(parsed.data.repoId);
  } catch {
    return NextResponse.json({ error: 'invalid repoId' }, { status: 400 });
  }

  // Verify repo exists — minimal projection (id only) to keep cost down.
  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { id: true },
  });
  if (!repo) {
    return NextResponse.json({ error: 'repository not found' }, { status: 404 });
  }

  const job = await enqueueManualRefresh(repoId);
  void writeAudit({
    action: 'manual_refresh_trigger',
    targetType: 'repository',
    targetId: String(repoId),
    metadata: { jobId: job.id.toString(), priority: job.priority },
    actorUserId: user.id,
    ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
  });

  return NextResponse.json({ ok: true, jobId: job.id.toString() });
}
