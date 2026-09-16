import type { ReactElement } from 'react';
import type { RefreshJobStatus } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { listRefreshJobs } from '@/lib/db/refresh-jobs';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { formatDateTime } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';
import { RefreshJobsFilters } from './_components/refresh-jobs-filters';

type Row = Awaited<ReturnType<typeof listRefreshJobs>>['rows'][number];

const STATUS_VARIANT: Record<
  RefreshJobStatus,
  'ok' | 'warn' | 'danger' | 'info' | 'neutral'
> = {
  pending: 'neutral',
  in_progress: 'info',
  done: 'ok',
  failed: 'danger',
};

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 200;
const ERROR_TRUNCATE_LEN = 60;

function parseStatus(s?: string): RefreshJobStatus | undefined {
  return s === 'pending' ||
    s === 'in_progress' ||
    s === 'done' ||
    s === 'failed'
    ? s
    : undefined;
}

function parseKind(k?: string): 'core' | 'releases' | 'branches' | undefined {
  return k === 'core' || k === 'releases' || k === 'branches' ? k : undefined;
}

/** Parse a YYYY-MM-DD string from `<input type="date">` as the start of
 *  that day in UTC. Returns undefined for missing / unparseable input. */
function parseDayStart(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Parse a YYYY-MM-DD string as the end of that day in UTC. Used as the
 *  exclusive upper bound for `to` so the day is fully included. */
function parseDayEnd(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(`${s}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Admin → Refresh jobs (M33.0)
 *
 * Flat, paginated view of every row in `refresh_jobs`. Filters compose:
 * status / kind / owner / name substring / updatedAt range. Pagination is
 * skip/take with `extraSearch` so filter params survive Next / Prev.
 *
 * View-only by design — Retry/Cancel actions live on `/admin/queue` cards.
 * Data is written by the scheduler tick (every 1000ms by default); the
 * user refreshes the browser to see new rows.
 */
export default async function AdminRefreshJobsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    kind?: string;
    owner?: string;
    name?: string;
    from?: string;
    to?: string;
    limit?: string;
    offset?: string;
  }>;
}): Promise<ReactElement> {
  const { user } = await requireAdmin();
  const sp = await searchParams;

  const t = await getTranslations('admin.refreshJobs');
  const tPag = await getTranslations('admin.common.pagination');
  const userTz = await resolveRequestTimezone({ dbValue: user.timezone });

  const status = parseStatus(sp.status);
  const kind = parseKind(sp.kind);
  const owner = sp.owner?.trim() ? sp.owner.trim() : undefined;
  const name = sp.name?.trim() ? sp.name.trim() : undefined;
  const from = parseDayStart(sp.from);
  const to = parseDayEnd(sp.to);

  const rawLimit = Number(sp.limit ?? PAGE_SIZE_DEFAULT);
  const rawOffset = Number(sp.offset ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(PAGE_SIZE_MAX, Math.max(1, rawLimit))
    : PAGE_SIZE_DEFAULT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  const { rows, total } = await listRefreshJobs({
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
    ...(owner ? { owner } : {}),
    ...(name ? { name } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    skip: offset,
    take: limit,
  });

  function truncate(s: string | null): string {
    if (s === null) return t('list.dash');
    return s.length > ERROR_TRUNCATE_LEN ? `${s.slice(0, ERROR_TRUNCATE_LEN)}…` : s;
  }

  const columns: AdminColumn<Row>[] = [
    {
      key: 'id',
      header: t('column.id'),
      render: (r) => (
        <code className="ghc-admin-mono">#{r.id.toString()}</code>
      ),
    },
    {
      key: 'repo',
      header: t('column.repo'),
      render: (r) => (
        <code className="ghc-admin-mono">
          {r.owner}/{r.name}
        </code>
      ),
    },
    {
      key: 'kind',
      header: t('column.kind'),
      render: (r) => (
        <span className="ghc-admin-chip ghc-admin-chip-info">
          {t(`kind.${r.kind}` as 'kind.core' | 'kind.releases' | 'kind.branches')}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('column.status'),
      render: (r) => (
        <AdminStatusChip variant={STATUS_VARIANT[r.status]}>
          {t(
            `status.${r.status}` as
              | 'status.pending'
              | 'status.in_progress'
              | 'status.done'
              | 'status.failed',
          )}
        </AdminStatusChip>
      ),
    },
    {
      key: 'priority',
      header: t('column.priority'),
      render: (r) => r.priority,
      align: 'right',
    },
    {
      key: 'scheduled',
      header: t('column.scheduled'),
      render: (r) => formatDateTime(r.scheduledFor, userTz),
      align: 'right',
    },
    {
      key: 'updated',
      header: t('column.updated'),
      render: (r) => formatDateTime(r.updatedAt, userTz),
      align: 'right',
    },
    {
      key: 'attempts',
      header: t('column.attempts'),
      render: (r) => r.attempts,
      align: 'right',
    },
    {
      key: 'error',
      header: t('column.error'),
      render: (r) =>
        r.lastError ? (
          <span className="ghc-admin-error-cell" title={r.lastError}>
            {truncate(r.lastError)}
          </span>
        ) : (
          <span className="ghc-admin-muted">{t('list.dash')}</span>
        ),
    },
  ];

  // Preserve filter params across pagination — strip empty strings so they
  // don't pollute the URL with `?owner=&from=` etc.
  const extraSearch: Record<string, string> = {};
  if (status) extraSearch.status = status;
  if (kind) extraSearch.kind = kind;
  if (owner) extraSearch.owner = owner;
  if (name) extraSearch.name = name;
  if (sp.from) extraSearch.from = sp.from;
  if (sp.to) extraSearch.to = sp.to;

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.refreshJobs') },
        ]}
        title={t('title')}
        description={t('description')}
      />

      <RefreshJobsFilters />

      <AdminTable<Row>
        columns={columns}
        rows={rows}
        // pagination handled by separate AdminPagination below — passing
        // pagination={undefined} avoids the double-pagination bug that
        // the AdminTable inline Pagination would otherwise produce.
        emptyTitle={t('list.empty.title')}
        emptyDescription={t('list.empty.description')}
        ariaLabel={t('list.ariaLabel')}
      />
      <AdminPagination
        basePath="/admin/refresh-jobs"
        offset={offset}
        limit={limit}
        total={total}
        rowsOnPage={rows.length}
        label={tPag('showing', {
          start: total === 0 ? 0 : offset + 1,
          end: offset + rows.length,
          total,
        })}
        extraSearch={extraSearch}
      />
    </div>
  );
}