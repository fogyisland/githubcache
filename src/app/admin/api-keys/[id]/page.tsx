import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { getApiKeyById } from '@/lib/db/api-keys';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { LimitsForm } from './_components/limits-form';
import { KeyActions } from './_components/key-actions';
import { queryAuditLog } from '@/lib/db/audit';

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
  params: { id: string };
}): Promise<ReactElement> {
  const id = BigInt(params.id);
  const key = await getApiKeyById(id);
  if (!key) notFound();

  const recentAudit = await queryAuditLog({
    targetType: 'api_key',
    limit: 10,
    offset: 0,
  });

  const auditColumns: AdminColumn<AuditRow>[] = [
    {
      key: 'time',
      header: 'When',
      render: (r) => r.createdAt.toISOString().replace('T', ' ').slice(0, 19),
    },
    {
      key: 'action',
      header: 'Action',
      render: (r) => (
        <AdminStatusChip variant="neutral">{r.action}</AdminStatusChip>
      ),
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: 'Admin', href: '/admin' },
          { label: 'API Keys', href: '/admin/api-keys' },
          { label: key.name },
        ]}
        title={key.name}
        description={`Owned by ${key.user.email} (${key.user.role})`}
      />

      <section className="ghc-admin-detail-card">
        <dl className="ghc-admin-detail-dl">
          <div className="ghc-admin-detail-row">
            <dt>Prefix</dt>
            <dd>
              <code className="ghc-admin-mono">{key.keyPrefix}…</code>{' '}
              <span className="ghc-admin-detail-hint">(full key never displayed)</span>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Status</dt>
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
                {key.status}
              </AdminStatusChip>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Created</dt>
            <dd>{key.createdAt.toISOString().replace('T', ' ').slice(0, 19)}</dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Approved</dt>
            <dd>
              {key.approvedAt
                ? `${key.approvedAt.toISOString().replace('T', ' ').slice(0, 19)} by #${key.approvedBy}`
                : '—'}
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Revoked</dt>
            <dd>
              {key.revokedAt
                ? key.revokedAt.toISOString().replace('T', ' ').slice(0, 19)
                : '—'}
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Last used</dt>
            <dd>
              {key.lastUsedAt
                ? key.lastUsedAt.toISOString().replace('T', ' ').slice(0, 19)
                : 'never'}
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Requests (24h)</dt>
            <dd>
              <strong>{key.requestCountLast24h.toLocaleString()}</strong>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Rate limit</dt>
            <dd>
              {key.rateLimitPerMin.toLocaleString()}/min ·{' '}
              {key.dailyQuota.toLocaleString()}/day
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="ghc-admin-section-title">Limits</h2>
        <LimitsForm
          apiKeyId={key.id.toString()}
          currentRateLimit={key.rateLimitPerMin}
          currentDailyQuota={key.dailyQuota}
        />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">Actions</h2>
        <KeyActions apiKeyId={key.id.toString()} currentStatus={key.status} />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          Recent activity{' '}
          <span className="ghc-admin-section-count">({recentAudit.total})</span>
        </h2>
        <AdminTable<AuditRow>
          columns={auditColumns}
          rows={recentAudit.rows}
          emptyTitle="No recent activity for this key"
          ariaLabel="Recent audit entries for this API key"
        />
      </section>
    </div>
  );
}