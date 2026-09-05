import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { listAllSubscriptions } from '@/lib/webhooks/db';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { AddWebhookForm } from './_components/add-webhook-form';
import { WebhookActions } from './_components/webhook-actions';
import { formatDateTime } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

type SubRow = Awaited<ReturnType<typeof listAllSubscriptions>>['rows'][number];

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 200;

/**
 * Admin → Webhooks page (M14.6).
 *
 * Admin-only. Lists webhook subscriptions with their last-delivery
 * status + the AddWebhookForm at the top. Each row links to a detail
 * page showing the delivery log.
 */
export default async function AdminWebhooksPage({
  searchParams,
}: {
  searchParams: { limit?: string; offset?: string };
}): Promise<ReactElement> {
  const cookieStore = cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const user = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!user || user.role !== 'admin') {
    redirect('/admin');
  }

  const userTz = resolveRequestTimezone({ dbValue: user.timezone });

  const t = await getTranslations('admin.webhooks');
  const tPag = await getTranslations('admin.common.pagination');

  const rawLimit = Number(searchParams.limit ?? PAGE_SIZE_DEFAULT);
  const rawOffset = Number(searchParams.offset ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(PAGE_SIZE_MAX, Math.max(1, rawLimit))
    : PAGE_SIZE_DEFAULT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  const { rows: subs, total } = await listAllSubscriptions({ skip: offset, take: limit });

  const columns: AdminColumn<SubRow>[] = [
    {
      key: 'url',
      header: t('list.column.url'),
      render: (s) => (
        <a href={`/admin/webhooks/${s.id.toString()}`} className="ghc-admin-mono">
          {s.url}
        </a>
      ),
    },
    {
      key: 'filter',
      header: t('list.column.filter'),
      render: (s) => {
        const filter = Array.isArray(s.eventFilter) ? (s.eventFilter as unknown[]) : [];
        const text = filter.includes('*') ? '*' : filter.join(', ');
        return <code className="ghc-admin-mono">{text}</code>;
      },
    },
    {
      key: 'status',
      header: t('list.column.status'),
      render: (s) => (
        <AdminStatusChip variant={s.active ? 'ok' : 'warn'}>
          {s.active ? t('status.active') : t('status.disabled')}
        </AdminStatusChip>
      ),
    },
    {
      key: 'lastDelivery',
      header: t('list.column.lastDelivery'),
      render: (s) => {
        if (!s.lastDeliveryAt) return t('list.never');
        const date = formatDateTime(s.lastDeliveryAt, userTz).slice(0, 16);
        const status = s.lastDeliveryStatus ?? 'pending';
        const variant =
          status === 'delivered' ? 'ok' : status === 'failed' ? 'warn' : 'danger';
        return (
          <span className="ghc-admin-delivery-cell">
            <AdminStatusChip variant={variant}>{t(`delivery.${status}`)}</AdminStatusChip>
            <span className="ghc-admin-delivery-when">{date}</span>
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      render: (s) => (
        <WebhookActions
          subscriptionId={s.id.toString()}
          currentActive={s.active}
        />
      ),
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumbAdmin'), href: '/admin' },
          { label: t('breadcrumbWebhooks') },
        ]}
        title={t('title')}
        description={t('description')}
      />

      <section>
        <h2 className="ghc-admin-section-title">{t('addHeading')}</h2>
        <AddWebhookForm />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          {t('list.heading')}{' '}
          <span className="ghc-admin-section-count">({total})</span>
        </h2>
        <AdminTable<SubRow>
          columns={columns}
          rows={subs}
          emptyTitle={t('list.empty.title')}
          emptyDescription={t('list.empty.description')}
          ariaLabel={t('list.ariaLabel')}
        />
        <AdminPagination
          basePath="/admin/webhooks"
          offset={offset}
          limit={limit}
          total={total}
          rowsOnPage={subs.length}
          label={tPag('showing', {
            start: total === 0 ? 0 : offset + 1,
            end: offset + subs.length,
            total,
          })}
        />
      </section>
    </div>
  );
}