import { prisma } from '@/lib/db/client';
import { poolSize } from '@/lib/github/pool';
import { isPaused } from '@/lib/scheduler/state';
import type { z } from 'zod';
import type { v1StatusSchema } from './schemas/v1-status';

const STARTED_AT = new Date().toISOString();

export type V1Status = z.infer<typeof v1StatusSchema>;

/**
 * Collects the same service-wide stats exposed by GET /api/v1/status, but
 * callable from server components / tests without an HTTP round-trip.
 *
 * Used by:
 *   - src/app/api/v1/status/route.ts (HTTP boundary)
 *   - src/app/docs/_components/live-status-widget.tsx (docs landing widget)
 *
 * Returns `null` when the DB is unreachable so the caller can decide whether
 * to render a degraded badge (widget) or return 503 (route).
 */
export async function collectV1Status(): Promise<V1Status | null> {
  let dbUp = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    dbUp = false;
  }
  if (!dbUp) return null;

  const [repoGroups, queueGroups, tokens, doneLast24h] = await Promise.all([
    prisma.repository.groupBy({ by: ['fetchStatus'], _count: true }),
    prisma.refreshJob.groupBy({ by: ['status'], _count: true }),
    prisma.githubToken.findMany({
      where: { status: 'active' },
      select: { requestsUsed: true, requestsLimit: true, resetAt: true },
    }),
    prisma.refreshJob.count({
      where: {
        status: 'done',
        updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
      },
    }),
  ]);

  const repoCount = (s: string): number =>
    repoGroups.find((g) => g.fetchStatus === s)?._count ?? 0;
  const queueCount = (s: string): number =>
    queueGroups.find((g) => g.status === s)?._count ?? 0;

  const now = Date.now();
  const exhausted = tokens.filter(
    (t) =>
      t.requestsUsed >= t.requestsLimit &&
      t.resetAt !== null &&
      t.resetAt.getTime() > now,
  ).length;

  return {
    ok: true,
    db: 'up',
    tokens: { active: poolSize(), exhausted, total: tokens.length, source: 'db' as const },
    queue: {
      pending: queueCount('pending'),
      in_progress: queueCount('in_progress'),
      done: doneLast24h,
      failed: queueCount('failed'),
    },
    repositories: {
      total: repoGroups.reduce((acc, g) => acc + g._count, 0),
      ok: repoCount('ok'),
      not_found: repoCount('not_found'),
      forbidden: repoCount('forbidden'),
      error: repoCount('error'),
    },
    scheduler: {
      paused: isPaused(),
    },
    version: {
      commit: process.env.GIT_COMMIT ?? 'unknown',
      startedAt: STARTED_AT,
      nodeVersion: process.version,
    },
    timestamp: new Date().toISOString(),
  };
}
