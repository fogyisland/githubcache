import type { ReactElement } from 'react';
import Link from 'next/link';
import type { EmailLogStatus } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { listEmailLog } from '@/lib/email/log';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminFilterBar } from '@/app/admin/_components/admin-filter-bar';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { formatDateTime } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

type EmailLogRow = Awaited<ReturnType<typeof listEmailLog>>['rows'][number];

const STATUS_VARIANT: Record<EmailLogStatus, 'ok' | 'warn' | 'danger'> = {
  queued: 'warn',
  sent: 'ok',
  failed: 'danger',
};

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 200;

const ALL_STATUSES: EmailLogStatus[] = ['queued', 'sent', 'failed'];

const TEMPLATE_KEYS = ['invite', 'password-reset', 'api-key-approved', 'daily-report', 'weekly-report', 'test'] as const;
type TemplateKey = (typeof TEMPLATE_KEYS)[number];

function isEmailLogStatus(s: string | undefined): s is EmailLogStatus {
  return s !== undefined && (ALL_STATUSES as string[]).includes(s);
}

function isTemplateKey(s: string | undefined): s is TemplateKey {
  return s !== undefined && (TEMPLATE_KEYS as readonly string[]).includes(s);
}

/**
 * M25 — admin Email log page.
 *
 * Server component. Lists email_log rows newest first with status +
 * templateKey filters (URL-synced) + pagination.
 */
export default async function AdminEmailLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; templateKey?: string; limit?: string; offset?: string }> }): Promise<ReactElement> {
  const sp = await searchParams;
  const userTz = await resolveRequestTimezone({});

  const t = await getTranslations('admin.emailLog');
  const tPag = await getTranslations('admin.common.pagination');

  const filterStatus: EmailLogStatus | undefined = isEmailLogStatus(sp.status)
    ? sp.status
    : undefined;
  const filterTemplateKey: TemplateKey | undefined = isTemplateKey(sp.templateKey)
    ? sp.templateKey
    : undefined;

  const rawLimit = Number(sp.limit ?? PAGE_SIZE_DEFAULT);
  const rawOffset = Number(sp.offset ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(PAGE_SIZE_MAX, Math.max(1, rawLimit))
    : PAGE_SIZE_DEFAULT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  const { rows, total } = await listEmailLog({
    skip: offset,
    take: limit,
    ...(filterStatus ? { status: filterStatus } : {}),
    ...(filterTemplateKey ? { templateKey: filterTemplateKey } : {}),
  });

  const columns: AdminColumn<EmailLogRow>[] = [
    {
      key: 'when',
      header: t('column.when'),
      render: (r) => formatDateTime(r.createdAt, userTz),
    },
    { key: 'recipient', header: t('column.recipient'), render: (r) => r.recipient },
    {
      key: 'templateKey',
      header: t('column.templateKey'),
      render: (r) => <code className="ghc-admin-mono">{r.templateKey}</code>,
    },
    { key: 'subject', header: t('column.subject'), render: (r) => r.subject },
    {
      key: 'status',
      header: t('column.status'),
      render: (r) => (
        <AdminStatusChip variant={STATUS_VARIANT[r.status]}>
          {t(`status.${r.status}` as 'status.queued' | 'status.sent' | 'status.failed')}
        </AdminStatusChip>
      ),
    },
    {
      key: 'error',
      header: t('column.error'),
      render: (r) => (r.errorMessage ? <span title={r.errorMessage}>{truncate(r.errorMessage, 60)}</span> : t('errorDash')),
    },
  ];

  const values: Record<string, string> = {};
  if (filterStatus) values.status = filterStatus;
  if (filterTemplateKey) values.templateKey = filterTemplateKey;

  const extraSearch: Record<string, string> = {};
  if (filterStatus) extraSearch.status = filterStatus;
  if (filterTemplateKey) extraSearch.templateKey = filterTemplateKey;

  const hasActiveFilter = filterStatus !== undefined || filterTemplateKey !== undefined;

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumbAdmin'), href: '/admin' },
          { label: t('breadcrumbEmail'), href: '/admin/email' },
          { label: t('breadcrumbLog') },
        ]}
        title={t('title')}
        description={t('description')}
      />

      <AdminFilterBar
        filters={[
          {
            name: 'status',
            label: t('filter.status'),
            options: ALL_STATUSES.map((s) => ({ value: s, label: t(`status.${s}` as 'status.queued' | 'status.sent' | 'status.failed') })),
          },
          {
            name: 'templateKey',
            label: t('filter.templateKey'),
            options: TEMPLATE_KEYS.map((k) => ({ value: k, label: t(`templateKey.${k}` as `templateKey.${TemplateKey}`) })),
          },
        ]}
        basePath="/admin/email/log"
        {...(Object.keys(values).length > 0 ? { values } : {})}
      />

      <AdminTable<EmailLogRow>
        columns={columns}
        rows={rows}
        emptyTitle={t('empty.title')}
        emptyDescription={t('empty.description')}
        emptyAction={
          hasActiveFilter ? (
            <Link href="/admin/email/log" className="ghc-btn-ghost">
              {t('empty.reset')}
            </Link>
          ) : undefined
        }
        ariaLabel={t('title')}
      />
      <AdminPagination
        basePath="/admin/email/log"
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

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
