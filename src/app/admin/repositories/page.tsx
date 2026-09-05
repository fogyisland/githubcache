import type { ReactElement } from 'react';
import type { FetchStatus } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { listRepositories } from '@/lib/db/repositories';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminFilterBar } from '@/app/admin/_components/admin-filter-bar';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip, type AdminChipVariant } from '@/app/admin/_components/admin-status-chip';

type RepoRow = Awaited<ReturnType<typeof listRepositories>>['rows'][number];

const FETCH_STATUS_VARIANT: Record<FetchStatus, AdminChipVariant> = {
  ok: 'ok',
  not_found: 'warn',
  forbidden: 'warn',
  error: 'danger',
};

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 200;

/**
 * Admin → Imported Nodes page ("已入库节点"). Lists every row in
 * `repositories` so operators can audit which GitHub repos have been
 * pulled into the cache, in what state, and when last refreshed.
 *
 * Mirrors /admin/api-keys: AdminPageHeader + AdminFilterBar (fetch status)
 * + AdminTable + AdminPagination. Status filter is URL-synced so deep
 * links preserve selection (and pagination carries it forward).
 *
 * Each row's owner/name is a link to the admin-side detail page at
 * `/admin/repositories/[owner]/[name]` — that page renders the cached
 * row state, refresh history, and audit trail for that repo. The public
 * `/repo/[owner]/[name]` page is still reachable via the footer link.
 */
export default async function AdminRepositoriesPage({
  searchParams,
}: {
  searchParams: { status?: string; limit?: string; offset?: string };
}): Promise<ReactElement> {
  const t = await getTranslations('admin.repositories');
  const tPag = await getTranslations('admin.common.pagination');

  const filterStatus: FetchStatus | undefined =
    searchParams.status === 'ok' ||
    searchParams.status === 'not_found' ||
    searchParams.status === 'forbidden' ||
    searchParams.status === 'error'
      ? searchParams.status
      : undefined;

  const rawLimit = Number(searchParams.limit ?? PAGE_SIZE_DEFAULT);
  const rawOffset = Number(searchParams.offset ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(PAGE_SIZE_MAX, Math.max(1, rawLimit))
    : PAGE_SIZE_DEFAULT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  const { rows: repos, total } = await listRepositories({
    ...(filterStatus ? { fetchStatus: filterStatus } : {}),
    skip: offset,
    take: limit,
  });

  const columns: AdminColumn<RepoRow>[] = [
    {
      key: 'owner',
      header: t('list.column.owner'),
      render: (r) => <code className="ghc-admin-mono">{r.owner}</code>,
    },
    {
      key: 'name',
      header: t('list.column.name'),
      render: (r) => <code className="ghc-admin-mono">{r.name}</code>,
    },
    {
      key: 'status',
      header: t('list.column.status'),
      render: (r) => (
        <AdminStatusChip variant={FETCH_STATUS_VARIANT[r.fetchStatus]}>
          {t(`status.${r.fetchStatus}` as 'status.ok')}
        </AdminStatusChip>
      ),
    },
    {
      key: 'lastFetched',
      header: t('list.column.lastFetched'),
      render: (r) => (r.lastFetchedAt ? r.lastFetchedAt.toISOString().slice(0, 10) : t('list.never')),
    },
    {
      key: 'error',
      header: t('list.column.error'),
      render: (r) =>
        r.fetchError ? (
          <span className="ghc-admin-error-cell" title={r.fetchError}>
            {r.fetchError.length > 60 ? `${r.fetchError.slice(0, 60)}…` : r.fetchError}
          </span>
        ) : (
          <span className="ghc-admin-muted">{t('list.dash')}</span>
        ),
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumbAdmin'), href: '/admin' },
          { label: t('breadcrumbRepositories') },
        ]}
        title={t('title')}
        description={t('description')}
      />

      <AdminFilterBar
        filters={[
          {
            name: 'status',
            label: t('list.filter.status'),
            options: [
              { value: 'ok', label: t('status.ok') },
              { value: 'not_found', label: t('status.not_found') },
              { value: 'forbidden', label: t('status.forbidden') },
              { value: 'error', label: t('status.error') },
            ],
          },
        ]}
        basePath="/admin/repositories"
        {...(filterStatus ? { values: { status: filterStatus } } : {})}
      />

      <AdminTable<RepoRow>
        columns={columns}
        rows={repos}
        rowHref={(r) => `/admin/repositories/${r.owner}/${r.name}`}
        emptyTitle={t('list.empty.title')}
        emptyDescription={t('list.empty.description')}
        ariaLabel={t('list.ariaLabel')}
      />
      <AdminPagination
        basePath="/admin/repositories"
        offset={offset}
        limit={limit}
        total={total}
        rowsOnPage={repos.length}
        label={tPag('showing', {
          start: total === 0 ? 0 : offset + 1,
          end: offset + repos.length,
          total,
        })}
        extraSearch={{
          ...(filterStatus ? { status: filterStatus } : {}),
        }}
      />
    </div>
  );
}
