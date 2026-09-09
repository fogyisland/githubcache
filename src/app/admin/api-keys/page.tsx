import type { ReactElement } from 'react';
import type { ApiKeyStatus } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { listApiKeys } from '@/lib/db/api-keys';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminFilterBar } from '@/app/admin/_components/admin-filter-bar';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { formatDate } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';
import { KeyRowActions } from './_components/key-row-actions';

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
  searchParams: Promise<{ status?: string; limit?: string; offset?: string }> }): Promise<ReactElement> {
  const sp = await searchParams;
  // api-keys page doesn't validate its own session (layout.tsx gates auth);
  // read timezone from cookie/default only — no DB roundtrip.
  const userTz = await resolveRequestTimezone({});

  const t = await getTranslations('admin.apiKeys');
  const tPag = await getTranslations('admin.common.pagination');

  const filterStatus: ApiKeyStatus | undefined =
    sp.status === 'pending' ||
    sp.status === 'active' ||
    sp.status === 'revoked'
      ? sp.status
      : undefined;

  const rawLimit = Number(sp.limit ?? PAGE_SIZE_DEFAULT);
  const rawOffset = Number(sp.offset ?? 0);
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
      render: (k) => (
        <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
          <code className="ghc-admin-mono">{k.keyPrefix}…</code>
          {k.keyPrefix.startsWith('ghc_usr_') && (
            <span
              className="ghc-admin-chip"
              style={{
                fontSize: '0.65rem',
                padding: '0.1rem 0.4rem',
                borderRadius: '999px',
                background: 'var(--color-info-soft)',
                color: 'var(--color-info)',
                fontWeight: 600,
              }}
              title="Requested by the operator from /account/keys/request"
            >
              {t('list.userRequested')}
            </span>
          )}
        </span>
      ),
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
        k.lastUsedAt ? formatDate(k.lastUsedAt, userTz) : t('list.never'),
    },
    {
      key: 'actions',
      header: t('list.column.actions'),
      // M28 — inline Approve / Reject / Revoke so the operator
      // doesn't have to click into the detail page to act.
      render: (k) => <KeyRowActions apiKeyId={k.id.toString()} status={k.status} />,
      align: 'right',
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
        // The inline action buttons need to stay clickable; don't
        // bubble the row-link click from the buttons themselves.
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