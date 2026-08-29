import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import {
  getSubscriptionById,
  listDeliveriesForSubscription,
} from '@/lib/webhooks/db';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { RetryDeliveryButton } from '../_components/retry-delivery-button';

type DeliveryRow = Awaited<
  ReturnType<typeof listDeliveriesForSubscription>
>[number];

const PAGE_SIZE_DEFAULT = 50;

interface PageProps {
  params: { id: string };
  searchParams: { limit?: string };
}

/** Admin → Webhooks → detail. Shows URL, event filter, signing-secret
 *  fingerprint, recent deliveries, and per-delivery retry for dead/failed
 *  rows. Admin-only. */
export default async function AdminWebhookDetailPage({
  params,
  searchParams,
}: PageProps): Promise<ReactElement> {
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
  if (!user || user.role !== 'admin') {
    redirect('/admin');
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    notFound();
  }

  const sub = await getSubscriptionById(id);
  if (!sub) notFound();

  const t = await getTranslations('admin.webhooks.detail');

  const rawLimit = Number(searchParams.limit ?? PAGE_SIZE_DEFAULT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(200, Math.max(1, rawLimit))
    : PAGE_SIZE_DEFAULT;

  const deliveries = await listDeliveriesForSubscription(id, limit);

  // Secret fingerprint: first 8 + last 4 chars of the secret. The full
  // secret is never shown again after creation/rotation.
  const fingerprint = `${sub.secret.slice(0, 8)}…${sub.secret.slice(-4)}`;

  const filterArr = Array.isArray(sub.eventFilter)
    ? (sub.eventFilter as unknown[])
    : [];
  const filterText = filterArr.includes('*')
    ? '*'
    : (filterArr as string[]).join(', ');

  const deliveriesColumns: AdminColumn<DeliveryRow>[] = [
    {
      key: 'when',
      header: t('deliveries.column.when'),
      render: (d) => {
        const when = d.eventCreatedAt.toISOString().slice(0, 19).replace('T', ' ');
        return <span className="ghc-admin-mono">{when}</span>;
      },
    },
    {
      key: 'event',
      header: t('deliveries.column.event'),
      render: (d) => (
        <span className="ghc-admin-mono">
          {d.eventAction}:{d.eventTargetType}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('deliveries.column.status'),
      render: (d) => {
        const variant =
          d.status === 'delivered'
            ? 'ok'
            : d.status === 'pending'
              ? 'info'
              : d.status === 'failed'
                ? 'warn'
                : 'danger';
        return (
          <AdminStatusChip variant={variant}>
            {t(`deliveryStatus.${d.status}`)}
          </AdminStatusChip>
        );
      },
    },
    {
      key: 'attempts',
      header: t('deliveries.column.attempts'),
      render: (d) => <span className="ghc-admin-mono">{d.attemptCount}</span>,
    },
    {
      key: 'lastError',
      header: t('deliveries.column.lastError'),
      render: (d) => {
        if (!d.lastError) return <span className="ghc-admin-muted">—</span>;
        const truncated =
          d.lastError.length > 80
            ? `${d.lastError.slice(0, 77)}…`
            : d.lastError;
        return <span className="ghc-admin-mono">{truncated}</span>;
      },
    },
    {
      key: 'retry',
      header: '',
      render: (d) =>
        d.status === 'dead' || d.status === 'failed' ? (
          <RetryDeliveryButton deliveryId={d.id.toString()} />
        ) : null,
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumbAdmin'), href: '/admin' },
          { label: t('breadcrumbWebhooks'), href: '/admin/webhooks' },
          { label: t('breadcrumbDetail') },
        ]}
        title={sub.url}
        description={t('description')}
      />

      <section className="ghc-admin-detail-grid">
        <dl className="ghc-admin-detail-list">
          <div>
            <dt>{t('field.id')}</dt>
            <dd className="ghc-admin-mono">{sub.id.toString()}</dd>
          </div>
          <div>
            <dt>{t('field.url')}</dt>
            <dd className="ghc-admin-mono">{sub.url}</dd>
          </div>
          <div>
            <dt>{t('field.filter')}</dt>
            <dd className="ghc-admin-mono">{filterText}</dd>
          </div>
          <div>
            <dt>{t('field.status')}</dt>
            <dd>
              <AdminStatusChip variant={sub.active ? 'ok' : 'warn'}>
                {sub.active ? t('status.active') : t('status.disabled')}
              </AdminStatusChip>
            </dd>
          </div>
          <div>
            <dt>{t('field.secret')}</dt>
            <dd className="ghc-admin-mono" data-testid="ghc-webhook-secret-fingerprint">
              {fingerprint}
            </dd>
          </div>
          <div>
            <dt>{t('field.createdAt')}</dt>
            <dd className="ghc-admin-mono">
              {sub.createdAt.toISOString().slice(0, 19).replace('T', ' ')}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="ghc-admin-section-title">{t('deliveries.heading')}</h2>
        <AdminTable<DeliveryRow>
          columns={deliveriesColumns}
          rows={deliveries}
          emptyTitle={t('deliveries.empty.title')}
          emptyDescription={t('deliveries.empty.description')}
          ariaLabel={t('deliveries.ariaLabel')}
        />
      </section>
    </div>
  );
}