import type { ReactElement } from 'react';
import type { ApiKeyStatus } from '@prisma/client';
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
  const filterStatus: ApiKeyStatus | undefined =
    searchParams.status === 'pending' ||
    searchParams.status === 'active' ||
    searchParams.status === 'revoked'
      ? searchParams.status
      : undefined;

  const keys = await listApiKeys(filterStatus ? { status: filterStatus } : undefined);

  const columns: AdminColumn<KeyRow>[] = [
    { key: 'name', header: 'Name', render: (k) => k.name },
    {
      key: 'prefix',
      header: 'Prefix',
      render: (k) => <code className="ghc-admin-mono">{k.keyPrefix}…</code>,
    },
    { key: 'owner', header: 'Owner', render: (k) => k.user.email },
    {
      key: 'status',
      header: 'Status',
      render: (k) => (
        <AdminStatusChip variant={STATUS_VARIANT[k.status]}>{k.status}</AdminStatusChip>
      ),
    },
    {
      key: 'rate',
      header: 'Rate/min',
      render: (k) => k.rateLimitPerMin.toLocaleString(),
      align: 'right',
    },
    {
      key: 'quota',
      header: 'Daily quota',
      render: (k) => k.dailyQuota.toLocaleString(),
      align: 'right',
    },
    {
      key: 'lastUsed',
      header: 'Last used',
      render: (k) =>
        k.lastUsedAt ? k.lastUsedAt.toISOString().slice(0, 10) : '—',
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[{ label: 'Admin', href: '/admin' }, { label: 'API Keys' }]}
        title="API Keys"
        description="Issue, approve, and revoke API keys. Filter by status to find specific keys fast."
      />

      <AdminFilterBar
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'pending', label: 'Pending' },
              { value: 'active', label: 'Active' },
              { value: 'revoked', label: 'Revoked' },
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
        emptyTitle="No API keys match this filter"
        emptyDescription="Try clearing the filter or invite a new operator."
        ariaLabel="API keys"
      />
    </div>
  );
}