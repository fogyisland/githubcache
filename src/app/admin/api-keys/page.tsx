import type { ReactElement } from 'react';
import type { ApiKeyStatus } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { listApiKeys } from '@/lib/db/api-keys';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminFilterBar } from '@/app/admin/_components/admin-filter-bar';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';

type KeyRow = Awaited<ReturnType<typeof listApiKeys>>['rows'][number];

const STATUS_VARIANT: Record<ApiKeyStatus, 'ok' | 'warn' | 'danger'> = {
  active: 'ok',
  pending: 'warn',
  revoked: 'danger',
};

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 200;

/**
 * Admin → API Keys page (M11.10 rewrite, M14.2 pagination).
 *
 * AdminPageHeader + AdminFilterBar (status) + AdminTable of keys with
 * status chips + pagination. Status filter is URL-synced so deep links /
 * refresh preserve selection (and pagination carries it forward).
 */
export default async function AdminApiKeysPage({
  searchParams,
}: {
  searchParams: { status?: string; limit?: string; offset?: string };
}): Promise<ReactElement> {
  const t = await getTranslations('admin.apiKeys');
  const tPag = await getTranslations('admin.common.pagination');

  const filterStatus: ApiKeyStatus | undefined =
    searchParams.status === 'pending' ||
    searchParams.status === 'active' ||
    searchParams.status === 'revoked'
      ? searchParams.status
      : undefined;

  const rawLimit = Number(searchParams.limit ?? PAGE_SIZE_DEFAULT);
  const rawOffset = Number(searchParams.offset ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(PAGE_SIZE_MAX, Math.max(1, rawLimit))
    : PAGE_SIZE_DEFAULT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  const { rows: keys, total } = await listApiKeys({
    ...(filterStatus ? { status: filterStatus } : {}),
    skip: offset,
    take: limit,
  });

  const columns: AdminColumn<KeyRow>[] = [
    { key: 'name', header: t('list.column.name'), render: (k) => k.name },
    {
      key: 'prefix',
      header: t('list.column.prefix'),
      render: (k) => <code className="ghc-admin-mono">{k.keyPrefix}…</code>,
    },
    { key: 'owner', header: t('list.column.owner'), render: (k) => k.user.email },
    {
      key: 'status',
      header: t('list.column.status'),
      render: (k) => (
        <AdminStatusChip variant={STATUS_VARIANT[k.status]}>
          {t(`status.${k.status}` as 'status.pending' | 'status.active' | 'status.revoked')}
        </AdminStatusChip>
      ),
    },
    {
      key: 'rate',
      header: t('list.column.rate'),
      render: (k) => k.rateLimitPerMin.toLocaleString(),
      align: 'right',
    },
    {
      key: 'quota',
      header: t('list.column.quota'),
      render: (k) => k.dailyQuota.toLocaleString(),
      align: 'right',
    },
    {
      key: 'lastUsed',
      header: t('list.column.lastUsed'),
      render: (k) =>
        k.lastUsedAt ? k.lastUsedAt.toISOString().slice(0, 10) : t('list.never'),
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumbAdmin'), href: '/admin' },
          { label: t('breadcrumbApiKeys') },
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
              { value: 'pending', label: t('status.pending') },
              { value: 'active', label: t('status.active') },
              { value: 'revoked', label: t('status.revoked') },
            ],
          },
        ]}
        basePath="/admin/api-keys"
        {...(filterStatus ? { values: { status: filterStatus } } : {})}
      />

      <AdminTable<KeyRow>
        columns={columns}
        rows={keys}
        rowHref={(k) => `/admin/api-keys/${k.id}`}
        emptyTitle={t('list.empty.title')}
        emptyDescription={t('list.empty.description')}
        ariaLabel={t('list.ariaLabel')}
      />
      <AdminPagination
        basePath="/admin/api-keys"
        offset={offset}
        limit={limit}
        total={total}
        rowsOnPage={keys.length}
        label={tPag('showing', {
          start: total === 0 ? 0 : offset + 1,
          end: offset + keys.length,
          total,
        })}
        extraSearch={{
          ...(filterStatus ? { status: filterStatus } : {}),
        }}
      />
    </div>
  );
}