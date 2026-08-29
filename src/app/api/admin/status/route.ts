import { NextResponse } from 'next/server';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { readAdminVariantFromRequest } from '@/lib/admin/cookie';
import { prisma } from '@/lib/db/client';
import { isPaused } from '@/lib/scheduler/state';
import { apiError } from '@/lib/api/errors';

/**
 * GET /api/admin/status
 *
 * Mission-control status bar payload (M11.5). Returns:
 *   - dbPingMs — round-trip time for a trivial Prisma query
 *   - queueDepth — pending RefreshJob count
 *   - schedulerState — 'RUNNING' | 'PAUSED' (process-local)
 *   - recentAuditCount — AuditLog rows in last 24h
 *   - user — { email, role } of the caller
 *   - variant — current admin variant cookie value
 *   - fetchedAt — ISO timestamp
 *
 * Auth: any authenticated operator/admin can read.
 *
 * Response codes:
 *   200 — status payload
 *   401 — not signed in
 */
export async function GET(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user) {
    return apiError('unauthorized', 'unauthorized', {}, req);
  }

  const variant = readAdminVariantFromRequest(req);

  // DB ping — single scalar query, take first row.
  const pingStart = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbPingMs = Date.now() - pingStart;

  const [queueDepth, recentAuditCount] = await Promise.all([
    prisma.refreshJob.count({ where: { status: 'pending' } }),
    prisma.auditLog.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);

  return NextResponse.json({
    dbPingMs,
    queueDepth,
    schedulerState: isPaused() ? 'PAUSED' : 'RUNNING',
    recentAuditCount,
    user: { email: user.email, role: user.role },
    variant,
    fetchedAt: new Date().toISOString(),
  });
}