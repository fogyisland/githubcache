import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/**
 * Ingestion aggregation helpers for the /admin/ingestion page (M16).
 *
 * Three numbers tell the story of the GitHub→DB pipeline at a glance:
 *   - ingestionSummary(from, to): pending/in-progress queue depth + done/failed
 *     throughput in a time window.
 *   - repositoryFetchBreakdown(): how many cached repos are in each terminal
 *     fetch status today (ok / not_found / forbidden / error).
 *   - recentRefreshJobs({skip, take}, from?, to?): join the latest refresh jobs
 *     with their parent repository so the admin can see what just ran (and
 *     what failed).
 *
 * All raw SQL stays close to its Prisma `$queryRaw` shape to match the style
 * already used in `src/lib/reports/queries.ts`.
 */

/**
 * Snapshot of the ingestion pipeline over a [from, to) window.
 *
 * `pending` and `inProgress` reflect the *current* queue state (not bound to
 * the window) so an admin landing on the page can see whether the scheduler
 * is keeping up — even if nothing completed in the last hour, the queue
 * tells them whether there is work waiting at all.
 *
 * `done` and `failed` count rows that reached those terminal states inside
 * the window. The scheduler ticks every minute, so a one-hour window is the
 * default cadence the UI uses.
 */
export interface IngestionSummary {
  pending: number;
  inProgress: number;
  done: number;
  failed: number;
}

export async function ingestionSummary(from: Date, to: Date): Promise<IngestionSummary> {
  const [pendingRow, inProgressRow] = await Promise.all([
    prisma.refreshJob.count({ where: { status: 'pending' } }),
    prisma.refreshJob.count({ where: { status: 'in_progress' } }),
  ]);
  const rows = await prisma.$queryRaw<
    Array<{ status: 'done' | 'failed'; count: bigint }>
  >`
    SELECT status, COUNT(*) AS count
    FROM refresh_jobs
    WHERE status IN ('done', 'failed')
      AND updated_at >= ${from} AND updated_at < ${to}
    GROUP BY status
  `;
  const counts = new Map<'done' | 'failed', number>(
    rows.map((r) => [r.status, Number(r.count)]),
  );
  return {
    pending: pendingRow,
    inProgress: inProgressRow,
    done: counts.get('done') ?? 0,
    failed: counts.get('failed') ?? 0,
  };
}

/**
 * How many cached repositories sit in each terminal `fetch_status` today.
 * The four values sum to `prisma.repository.count()` — every cached row has
 * exactly one of these states.
 */
export interface FetchStatusBreakdown {
  ok: number;
  not_found: number;
  forbidden: number;
  error: number;
}

export async function repositoryFetchBreakdown(): Promise<FetchStatusBreakdown> {
  const rows = await prisma.$queryRaw<
    Array<{ fetch_status: 'ok' | 'not_found' | 'forbidden' | 'error'; count: bigint }>
  >`
    SELECT fetch_status, COUNT(*) AS count
    FROM repositories
    GROUP BY fetch_status
  `;
  const out: FetchStatusBreakdown = { ok: 0, not_found: 0, forbidden: 0, error: 0 };
  for (const r of rows) {
    out[r.fetch_status] = Number(r.count);
  }
  return out;
}

export interface RecentRefreshJobRow {
  id: bigint;
  repositoryId: bigint;
  repositoryOwner: string;
  repositoryName: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  priority: number;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Recent refresh jobs joined with their parent repository. Used by the
 * /admin/ingestion "recent jobs" table.
 *
 * Pagination is applied at the Prisma layer (the join already includes the
 * repository in a single SQL roundtrip via `include`). Optional `from`/`to`
 * filter on `updatedAt` — the window the page currently shows in its KPIs.
 */
export async function recentRefreshJobs(
  args: { skip: number; take: number },
  filters?: { from?: Date; to?: Date },
): Promise<Array<RecentRefreshJobRow & { total: number }>> {
  const where: Prisma.RefreshJobWhereInput = {};
  if (filters?.from || filters?.to) {
    where.updatedAt = {};
    if (filters.from) where.updatedAt.gte = filters.from;
    if (filters.to) where.updatedAt.lt = filters.to;
  }
  const [rows, total] = await Promise.all([
    prisma.refreshJob.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: args.skip,
      take: args.take,
      include: {
        repository: { select: { owner: true, name: true } },
      },
    }),
    prisma.refreshJob.count({ where }),
  ]);
  return rows.map((r) => ({
    id: r.id,
    repositoryId: r.repositoryId,
    repositoryOwner: r.repository.owner,
    repositoryName: r.repository.name,
    status: r.status,
    priority: r.priority,
    attempts: r.attempts,
    lastError: r.lastError,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    total,
  }));
}