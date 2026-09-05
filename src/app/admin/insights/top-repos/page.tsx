import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import {
  distinctLanguages,
  topRepos,
  isInsightsSortKey,
  type InsightsSortKey,
} from '@/lib/reports/insights';
import { formatCount } from '@/lib/repo/metadata';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';
import { formatDate } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 200;

/**
 * Admin → Insights → Top Repos (M18).
 *
 * Paginated, sortable, language-filterable listing of cached GitHub repos
 * ordered by a chosen metadata field (default: stars). Reads from
 * `topRepos()` (raw SQL with JSON_EXTRACT expressions).
 *
 * Filter form is a plain `<form method="get">` so the page stays a server
 * component — filter submission reloads the page with the new query
 * params.
 */
export default async function AdminInsightsTopReposPage({
  searchParams,
}: {
  searchParams: { language?: string; sort?: string; limit?: string; offset?: string };
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

  const userTz = resolveRequestTimezone({ dbValue: user.timezone });

  const sortBy: InsightsSortKey = isInsightsSortKey(searchParams.sort)
    ? searchParams.sort
    : 'stars';

  const rawLimit = Number(searchParams.limit ?? PAGE_SIZE_DEFAULT);
  const rawOffset = Number(searchParams.offset ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(PAGE_SIZE_MAX, Math.max(1, rawLimit))
    : PAGE_SIZE_DEFAULT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;
  const languageFilter = searchParams.language?.trim() || undefined;

  const [languages, result] = await Promise.all([
    distinctLanguages(),
    topRepos({
      skip: offset,
      take: limit,
      ...(languageFilter ? { language: languageFilter } : {}),
      sortBy,
    }),
  ]);

  type Row = (typeof result.rows)[number];
  const columns: AdminColumn<Row>[] = [
    {
      key: 'owner',
      header: t('topRepos.column.owner'),
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
      key: 'stars',
      header: t('topRepos.column.stars'),
      align: 'right',
      render: (r) => formatCount(r.stars),
    },
    {
      key: 'forks',
      header: t('topRepos.column.forks'),
      align: 'right',
      render: (r) => formatCount(r.forks),
    },
    {
      key: 'watchers',
      header: t('topRepos.column.watchers'),
      align: 'right',
      render: (r) => formatCount(r.watchers),
    },
    {
      key: 'language',
      header: t('topRepos.column.language'),
      render: (r) => r.language ?? '–',
    },
    {
      key: 'license',
      header: t('topRepos.column.license'),
      render: (r) => r.license ?? '–',
    },
    {
      key: 'lastFetchedAt',
      header: t('topRepos.column.lastFetchedAt'),
      render: (r) =>
        r.lastFetchedAt ? formatDate(r.lastFetchedAt, userTz) : '–',
    },
  ];

  // Filter form extraSearch preserves language + sort so changing the page
  // size or pagination doesn't reset the filter.
  const extraSearch: Record<string, string> = { sort: sortBy };
  if (languageFilter) extraSearch.language = languageFilter;

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.insights'), href: '/admin/insights' },
          { label: t('topRepos.heading') },
        ]}
        title={t('topRepos.heading')}
        description={t('topRepos.description')}
      />

      <form action="/admin/insights/top-repos" method="get" className="ghc-admin-filter-bar">
        <label className="ghc-admin-filter-label">
          <span className="ghc-admin-filter-text">{t('topRepos.filterLanguage')}</span>
          <select
            name="language"
            defaultValue={languageFilter ?? ''}
            className="ghc-admin-filter-select"
          >
            <option value="">{t('topRepos.filterLanguageAll')}</option>
            {languages.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </label>
        <label className="ghc-admin-filter-label">
          <span className="ghc-admin-filter-text">{t('topRepos.filterSort')}</span>
          <select
            name="sort"
            defaultValue={sortBy}
            className="ghc-admin-filter-select"
          >
            {(['stars', 'forks', 'watchers', 'updated_at', 'last_fetched_at'] as const).map(
              (key) => (
                <option key={key} value={key}>
                  {t(`topRepos.sortKey.${key}`)}
                </option>
              ),
            )}
          </select>
        </label>
        <button type="submit" className="ghc-btn-primary">
          {t('stale.thresholdApply')}
        </button>
      </form>

      <AdminTable<Row>
        columns={columns}
        rows={result.rows}
        emptyTitle={t('topRepos.empty')}
        ariaLabel={t('topRepos.heading')}
      />
      <AdminPagination
        basePath="/admin/insights/top-repos"
        offset={offset}
        limit={limit}
        total={result.total}
        rowsOnPage={result.rows.length}
        label={tPag('showing', {
          start: result.total === 0 ? 0 : offset + 1,
          end: offset + result.rows.length,
          total: result.total,
        })}
        extraSearch={extraSearch}
      />
    </div>
  );
}
