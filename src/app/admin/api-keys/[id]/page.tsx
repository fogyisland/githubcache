import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { getApiKeyById } from '@/lib/db/api-keys';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { LimitsForm } from './_components/limits-form';
import { KeyActions } from './_components/key-actions';
import { queryAuditLog } from '@/lib/db/audit';
import { formatDateTime } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

interface AuditRow {
  id: bigint;
  action: string;
  createdAt: Date;
}

/**
 * Admin → API key detail page (M11.11 rewrite).
 *
 * Sections:
 *   1. AdminPageHeader (key name + prefix)
 *   2. Profile dl: prefix / owner / status / created / approved / revoked
 *      / last-used / 24h request count
 *   3. LimitsForm (existing client component)
 *   4. KeyActions (existing client component)
 *   5. Recent audit trail (top 10)
 */
export default async function AdminApiKeyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const p = await params;
  // api-keys detail doesn't validate its own session (layout.tsx gates auth);
  // read timezone from cookie/default only — no DB roundtrip.
  const userTz = await resolveRequestTimezone({});

  const id = BigInt(p.id);
  const key = await getApiKeyById(id);
  if (!key) notFound();

  const t = await getTranslations('admin.apiKeys.detail');

  const recentAudit = await queryAuditLog({
    targetType: 'api_key',
    limit: 10,
    offset: 0,
  });

  const auditColumns: AdminColumn<AuditRow>[] = [
    {
      key: 'time',
      header: t('auditColumns.when'),
      render: (r) => formatDateTime(r.createdAt, userTz),
    },
    {
      key: 'action',
      header: t('auditColumns.action'),
      render: (r) => (
        <AdminStatusChip variant="neutral">{r.action}</AdminStatusChip>
      ),
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumbAdmin'), href: '/admin' },
          { label: t('breadcrumbApiKeys'), href: '/admin/api-keys' },
          { label: key.name },
        ]}
        title={key.name}
        description={t('ownedBy', { email: key.user.email, role: t(`role.${key.user.role}` as 'role.admin' | 'role.operator') })}
      />

      <section className="ghc-admin-detail-card">
        <dl className="ghc-admin-detail-dl">
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.prefix')}</dt>
            <dd>
              <code className="ghc-admin-mono">{key.keyPrefix}…</code>{' '}
              <span className="ghc-admin-detail-hint">{t('profile.fullKeyHidden')}</span>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.status')}</dt>
            <dd>
              <AdminStatusChip
                variant={
                  key.status === 'active'
                    ? 'ok'
                    : key.status === 'pending'
                    ? 'warn'
                    : 'danger'
                }
              >
                {t(`status.${key.status}` as 'status.pending' | 'status.active' | 'status.revoked')}
              </AdminStatusChip>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.created')}</dt>
            <dd>{formatDateTime(key.createdAt, userTz)}</dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.approved')}</dt>
            <dd>
              {key.approvedAt
                ? t('profile.approvedAt', {
                    datetime: formatDateTime(key.approvedAt, userTz),
                    approver: `#${key.approvedBy}`,
                  })
                : t('common.dash')}
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.revoked')}</dt>
            <dd>
              {key.revokedAt
                ? formatDateTime(key.revokedAt, userTz)
                : t('common.dash')}
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.lastUsed')}</dt>
            <dd>
              {key.lastUsedAt
                ? formatDateTime(key.lastUsedAt, userTz)
                : t('profile.never')}
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.requests24h')}</dt>
            <dd>
              <strong>{key.requestCountLast24h.toLocaleString()}</strong>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.rateLimit')}</dt>
            <dd>
              {t('profile.rateLimitValue', {
                rate: key.rateLimitPerMin.toLocaleString(),
                quota: key.dailyQuota.toLocaleString(),
              })}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="ghc-admin-section-title">{t('limitsHeading')}</h2>
        <LimitsForm
          apiKeyId={key.id.toString()}
          currentRateLimit={key.rateLimitPerMin}
          currentDailyQuota={key.dailyQuota}
        />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">{t('actionsHeading')}</h2>
        <KeyActions apiKeyId={key.id.toString()} currentStatus={key.status} />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          {t('auditHeading')}{' '}
          <span className="ghc-admin-section-count">({recentAudit.total})</span>
        </h2>
        <AdminTable<AuditRow>
          columns={auditColumns}
          rows={recentAudit.rows}
          emptyTitle={t('auditEmpty.title')}
          ariaLabel={t('auditAriaLabel')}
        />
      </section>
    </div>
  );
}