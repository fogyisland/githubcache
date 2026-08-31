import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { staleRepos } from '@/lib/reports/insights';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 200;
const DEFAULT_THRESHOLD_DAYS = 7;
const MIN_THRESHOLD_DAYS = 1;
const MAX_THRESHOLD_DAYS = 365;

/**
 * Admin → Insights → Stale cache (M18).
 *
 * Lists cached repos whose `last_fetched_at` is older than `thresholdDays`
 * (URL-driven, default 7 days). The threshold form is a plain
 * `<form method="get">` so the page stays a server component.
 *
 * Stale repos are candidates for proactive re-fetch — operators can copy
 * the owner/name and queue them via /admin/refresh.
 */
export default async function AdminInsightsStalePage({
  searchParams,
}: {
  searchParams: { threshold?: string; limit?: string; offset?: string };
}): Promise<ReactElement> {
  const t = await getTranslations('admin.insights');
  const tPag = await getTranslations('admin.common.pagination');

  const cookieStore = cookies();
  const cookieMap = Object.fromEntries(
    cookieStore.getAll().map((c) => [c.name, c.value]),
  );
  const user = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!user) {
    redirect('/login');
  }
  if (user.role !== 'admin') {
    redirect('/admin');
  }

  const rawThreshold = Number(searchParams.threshold ?? DEFAULT_THRESHOLD_DAYS);
  const thresholdDays = Number.isFinite(rawThreshold)
    ? Math.min(MAX_THRESHOLD_DAYS, Math.max(MIN_THRESHOLD_DAYS, Math.round(rawThreshold)))
    : DEFAULT_THRESHOLD_DAYS;

  const rawLimit = Number(searchParams.limit ?? PAGE_SIZE_DEFAULT);
  const rawOffset = Number(searchParams.offset ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(PAGE_SIZE_MAX, Math.max(1, rawLimit))
    : PAGE_SIZE_DEFAULT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  const result = await staleRepos({ thresholdDays, skip: offset, take: limit });

  type Row = (typeof result.rows)[number];
  const columns: AdminColumn<Row>[] = [
    {
      key: 'owner',
      header: t('stale.column.owner'),
      render: (r) => (
        <a
          className="ghc-link"
          href={`https://github.com/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          {r.owner}/{r.name}
        </a>
      ),
    },
    {
      key: 'lastFetchedAt',
      header: t('stale.column.lastFetchedAt'),
      render: (r) => r.lastFetchedAt.toISOString().slice(0, 10),
    },
    {
      key: 'ageDays',
      header: t('stale.column.ageDays'),
      align: 'right',
      render: (r) => `${r.ageDays}d`,
    },
    {
      key: 'fetchStatus',
      header: t('stale.column.fetchStatus'),
      render: (r) => (
        <AdminStatusChip variant={r.fetchStatus === 'ok' ? 'ok' : 'warn'}>
          {r.fetchStatus}
        </AdminStatusChip>
      ),
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.insights'), href: '/admin/insights' },
          { label: t('stale.heading') },
        ]}
        title={t('stale.heading')}
        description={t('stale.description')}
      />

      <form action="/admin/insights/stale" method="get" className="ghc-admin-filter-bar">
        <label className="ghc-admin-filter-label">
          <span className="ghc-admin-filter-text">{t('stale.thresholdLabel')}</span>
          <input
            type="number"
            name="threshold"
            min={MIN_THRESHOLD_DAYS}
            max={MAX_THRESHOLD_DAYS}
            defaultValue={thresholdDays}
            className="ghc-admin-filter-input"
            aria-describedby="stale-threshold-help"
          />
        </label>
        <span id="stale-threshold-help" className="ghc-admin-filter-help">
          {t('stale.thresholdHelp')}
        </span>
        <button type="submit" className="ghc-btn-primary">
          {t('stale.thresholdApply')}
        </button>
      </form>

      <AdminTable<Row>
        columns={columns}
        rows={result.rows}
        emptyTitle={t('stale.empty')}
        ariaLabel={t('stale.heading')}
      />
      <AdminPagination
        basePath="/admin/insights/stale"
        offset={offset}
        limit={limit}
        total={result.total}
        rowsOnPage={result.rows.length}
        label={tPag('showing', {
          start: result.total === 0 ? 0 : offset + 1,
          end: offset + result.rows.length,
          total: result.total,
        })}
        extraSearch={{ threshold: String(thresholdDays) }}
      />
    </div>
  );
}
