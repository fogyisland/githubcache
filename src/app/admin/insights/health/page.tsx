import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { fetchStatusBreakdown, recentFetchFailures } from '@/lib/reports/insights';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminKpiCard } from '@/app/admin/_components/admin-kpi-card';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { formatDate } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 200;

/**
 * Admin → Insights → Fetch health (M18).
 *
 * Two regions:
 *   - Top KPI strip showing `fetch_status` counts (ok / not_found /
 *     forbidden / error) plus total. Same shape as /admin/ingestion's
 *     KPI strip — kept separate so this page can be linked directly
 *     without bouncing through ingestion.
 *   - Recent failures table — paginated list of repos in any non-OK
 *     `fetch_status`, most-recently-fetched first. Helps operators spot
 *     patterns (e.g. a wave of 404s) without diving into the audit log.
 */
export default async function AdminInsightsHealthPage({
  searchParams,
}: {
  searchParams: { limit?: string; offset?: string };
}): Promise<ReactElement> {
  const t = await getTranslations('insights');
  const tPag = await getTranslations('admin.common.pagination');

  const cookieStore = await cookies();
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

  const userTz = await resolveRequestTimezone({ dbValue: user.timezone });

  const rawLimit = Number(searchParams.limit ?? PAGE_SIZE_DEFAULT);
  const rawOffset = Number(searchParams.offset ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(PAGE_SIZE_MAX, Math.max(1, rawLimit))
    : PAGE_SIZE_DEFAULT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  const [breakdown, failures] = await Promise.all([
    fetchStatusBreakdown(),
    recentFetchFailures({ skip: offset, take: limit }),
  ]);

  const total =
    breakdown.ok +
    breakdown.not_found +
    breakdown.forbidden +
    breakdown.error;

  type Row = (typeof failures.rows)[number];
  const columns: AdminColumn<Row>[] = [
    {
      key: 'owner',
      header: t('health.column.owner'),
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
      header: t('health.column.lastFetchedAt'),
      render: (r) => formatDate(r.lastFetchedAt, userTz),
    },
    {
      key: 'fetchStatus',
      header: t('health.column.fetchStatus'),
      render: (r) => (
        <AdminStatusChip variant="warn">{r.fetchStatus}</AdminStatusChip>
      ),
    },
    {
      key: 'fetchError',
      header: t('health.column.fetchError'),
      render: (r) =>
        r.fetchError ? (
          <code className="ghc-admin-mono">{r.fetchError}</code>
        ) : (
          '–'
        ),
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.insights'), href: '/admin/insights' },
          { label: t('health.heading') },
        ]}
        title={t('health.heading')}
        description={t('health.description')}
      />

      <section>
        <div className="ghc-admin-kpi-grid">
          <AdminKpiCard
            label={t('health.kpiOk')}
            value={breakdown.ok}
            tone={breakdown.ok > 0 ? 'positive' : 'default'}
          />
          <AdminKpiCard
            label={t('health.kpiNotFound')}
            value={breakdown.not_found}
            tone={breakdown.not_found > 0 ? 'negative' : 'default'}
          />
          <AdminKpiCard
            label={t('health.kpiForbidden')}
            value={breakdown.forbidden}
            tone={breakdown.forbidden > 0 ? 'negative' : 'default'}
          />
          <AdminKpiCard
            label={t('health.kpiError')}
            value={breakdown.error}
            tone={breakdown.error > 0 ? 'negative' : 'default'}
          />
          <AdminKpiCard label={t('health.kpiTotal')} value={total} />
        </div>
      </section>

      <section>
        <h2 className="ghc-admin-section-title">{t('health.recentFailuresHeading')}</h2>
        <AdminTable<Row>
          columns={columns}
          rows={failures.rows}
          emptyTitle={t('health.recentEmpty')}
          ariaLabel={t('health.recentFailuresHeading')}
        />
        <AdminPagination
          basePath="/admin/insights/health"
          offset={offset}
          limit={limit}
          total={failures.total}
          rowsOnPage={failures.rows.length}
          label={tPag('showing', {
            start: failures.total === 0 ? 0 : offset + 1,
            end: offset + failures.rows.length,
            total: failures.total,
          })}
        />
      </section>
    </div>
  );
}
