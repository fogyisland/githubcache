import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { poolSize } from '@/lib/github/pool';
import { v1StatusSchema } from '@/lib/api-docs/schemas/v1-status';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
const STARTED_AT = new Date().toISOString();

interface StatusBody {
  ok: boolean;
  db: 'up' | 'down';
  tokens: { active: number; exhausted: number; total: number };
  queue: { pending: number; in_progress: number; done: number; failed: number };
  repositories: {
    total: number;
    ok: number;
    not_found: number;
    forbidden: number;
    error: number;
  };
  version: { commit: string; startedAt: string; nodeVersion: string };
  timestamp: string;
}

async function pingDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function GET(): Promise<Response> {
  const dbUp = await pingDb();
  if (!dbUp) {
    const body: StatusBody = {
      ok: false,
      db: 'down',
      tokens: { active: 0, exhausted: 0, total: 0 },
      queue: { pending: 0, in_progress: 0, done: 0, failed: 0 },
      repositories: { total: 0, ok: 0, not_found: 0, forbidden: 0, error: 0 },
      version: {
        commit: process.env.GIT_COMMIT ?? 'unknown',
        startedAt: STARTED_AT,
        nodeVersion: process.version,
      },
      timestamp: new Date().toISOString(),
    };
    const parsed = v1StatusSchema.safeParse(body);
    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues }, 'status payload schema mismatch');
      return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
    return NextResponse.json(parsed.data, { status: 503 });
  }

  const [repoGroups, queueGroups, tokens, doneLast24h] = await Promise.all([
    prisma.repository.groupBy({ by: ['fetchStatus'], _count: true }),
    prisma.refreshJob.groupBy({ by: ['status'], _count: true }),
    prisma.githubToken.findMany({
      where: { status: 'active' },
      select: { requestsUsed: true, requestsLimit: true, resetAt: true },
    }),
    // The brief asked for `done (last 24h)` — schema has no `completedAt`, so
    // we filter on `updatedAt` which Prisma auto-bumps on every save. `done`
    // rows are terminal: they're set to `done` once and never touched again,
    // so `updatedAt` reflects the moment of completion.
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

  const body: StatusBody = {
    ok: true,
    db: 'up',
    tokens: { active: poolSize(), exhausted, total: tokens.length },
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
    version: {
      commit: process.env.GIT_COMMIT ?? 'unknown',
      startedAt: STARTED_AT,
      nodeVersion: process.version,
    },
    timestamp: new Date().toISOString(),
  };

  const parsed = v1StatusSchema.safeParse(body);
  if (!parsed.success) {
    logger.error({ issues: parsed.error.issues }, 'status payload schema mismatch');
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
  return NextResponse.json(parsed.data, { status: 200 });
}
