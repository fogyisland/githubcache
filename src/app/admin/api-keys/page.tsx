import type { ReactElement } from 'react';
import type { ApiKeyStatus } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { listApiKeys } from '@/lib/db/api-keys';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminFilterBar } from '@/app/admin/_components/admin-filter-bar';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';

type KeyRow = Awaited<ReturnType<typeof listApiKeys>>[number];

const STATUS_VARIANT: Record<ApiKeyStatus, 'ok' | 'warn' | 'danger'> = {
  active: 'ok',
  pending: 'warn',
  revoked: 'danger',
};

/**
 * Admin → API Keys page (M11.10 rewrite).
 *
 * AdminPageHeader + AdminFilterBar (status) + AdminTable of keys with
 * status chips. Status filter is URL-synced so deep links / refresh
 * preserve selection.
 */
export default async function AdminApiKeysPage({
  searchParams,
}: {
  searchParams: { status?: string };
}): Promise<ReactElement> {
  const t = await getTranslations('admin.apiKeys');

  const filterStatus: ApiKeyStatus | undefined =
    searchParams.status === 'pending' ||
    searchParams.status === 'active' ||
    searchParams.status === 'revoked'
      ? searchParams.status
      : undefined;

  const keys = await listApiKeys(filterStatus ? { status: filterStatus } : undefined);

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
    </div>
  );
}