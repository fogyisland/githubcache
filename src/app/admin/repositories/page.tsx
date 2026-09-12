import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { listRepositories } from '@/lib/db/repositories';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { formatDate } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

type RepoRow = Awaited<ReturnType<typeof listRepositories>>['rows'][number];

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 200;

/**
 * Admin → Imported Nodes page ("已入库节点"). Lists every row in
 * `repositories` so operators can audit which GitHub repos have been
 * pulled into the cache, in what state, and when last refreshed.
 *
 * Mirrors /admin/api-keys: AdminPageHeader + AdminTable + AdminPagination.
 *
 * Post-M31 the `repositories` table only holds rows with a successful
 * GitHub fetch (200/304). Cache misses no longer create stub rows, and
 * 404/410/403 failures write to `refresh_jobs` + the audit log — not to
 * `repositories`. The fetch-status filter chip is therefore gone;
 * `fetchStatus` should always be 'ok' on rows rendered here.
 *
 * Each row's owner/name is a link to the admin-side detail page at
 * `/admin/repositories/[owner]/[name]` — that page renders the cached
 * row state, refresh history, and audit trail for that repo. The public
 * `/repo/[owner]/[name]` page is still reachable via the footer link.
 */
export default async function AdminRepositoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string; offset?: string }>;
}): Promise<ReactElement> {
  const sp = await searchParams;
  const t = await getTranslations('admin.repositories');
  const tPag = await getTranslations('admin.common.pagination');

  // M28 — admin tables use the user's TZ via the shared formatter
  // (CLAUDE.md: do NOT use `d.toISOString().slice(...)` for
  // user-facing dates — that pattern is reserved for machine APIs).
  const userTz = await resolveRequestTimezone({});

  const rawLimit = Number(sp.limit ?? PAGE_SIZE_DEFAULT);
  const rawOffset = Number(sp.offset ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(PAGE_SIZE_MAX, Math.max(1, rawLimit))
    : PAGE_SIZE_DEFAULT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  // No `fetchStatus` filter — post-M31 every row in `repositories` has
  // fetchStatus='ok' (failures are recorded in refresh_jobs + audit).
  // `?status=...` in the URL is silently ignored for backward compatibility.
  const { rows: repos, total } = await listRepositories({
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
        <AdminStatusChip variant={r.fetchStatus === 'ok' ? 'ok' : 'warn'}>
          {t(`status.${r.fetchStatus}` as 'status.ok')}
        </AdminStatusChip>
      ),
    },
    {
      key: 'lastFetched',
      header: t('list.column.lastFetched'),
      render: (r) => (r.lastFetchedAt ? formatDate(r.lastFetchedAt, userTz) : t('list.never')),
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

      <p className="ghc-admin-audit-note">{t('auditNote')}</p>

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
      />
    </div>
  );
}
