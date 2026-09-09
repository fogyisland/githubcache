import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { ReactElement } from 'react';
import { getTokenById } from '@/lib/db/github-tokens';
import { poolHasId } from '@/lib/github/pool';
import { validateSession } from '@/lib/auth/session';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { TokenActions } from '../_components/token-actions';
import { queryAuditLog } from '@/lib/db/audit';
import { formatDateTime } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

interface AuditRow {
  id: bigint;
  action: string;
  createdAt: Date;
}

/**
 * Admin → GitHub Token detail page (M11.11 — new page).
 *
 * Sections:
 *   1. AdminPageHeader (token label + first/last 4)
 *   2. Profile dl: prefix / status / pool state / usage / last used /
 *      reset window
 *   3. TokenActions (existing client component)
 *   4. Recent audit trail (top 10)
 */
export default async function AdminGithubTokenDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const p = await params;
  const cookieStore = await cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const session = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!session || session.role !== 'admin') {
    redirect('/admin');
  }

  const userTz = await resolveRequestTimezone({ dbValue: session.timezone });

  const t = await getTranslations('admin.githubTokens.detail');

  let id: bigint;
  try {
    id = BigInt(p.id);
  } catch {
    notFound();
  }

  const token = await getTokenById(id);
  if (!token) notFound();

  const inPool = poolHasId(token.id);
  const usagePct =
    token.requestsLimit > 0
      ? Math.round((token.requestsUsed / token.requestsLimit) * 100)
      : 0;

  const recentAudit = await queryAuditLog({
    targetType: 'github_token',
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
          { label: t('breadcrumbGithubTokens'), href: '/admin/github-tokens' },
          { label: token.label },
        ]}
        title={token.label}
        description={t('tokenPrefix', { first4: token.tokenFirst4, last4: token.tokenLast4 })}
      />

      <section className="ghc-admin-detail-card">
        <dl className="ghc-admin-detail-dl">
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.prefix')}</dt>
            <dd>
              <code className="ghc-admin-mono">
                {token.tokenFirst4}…{token.tokenLast4}
              </code>{' '}
              <span className="ghc-admin-detail-hint">{t('profile.fullTokenHidden')}</span>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.status')}</dt>
            <dd>
              <AdminStatusChip variant={token.status === 'active' ? 'ok' : 'warn'}>
                {t(`status.${token.status}` as 'status.active' | 'status.disabled')}
              </AdminStatusChip>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.poolState')}</dt>
            <dd>
              <AdminStatusChip variant={inPool ? 'ok' : 'warn'}>
                {inPool ? t('pool.inPool') : t('pool.notInPool')}
              </AdminStatusChip>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.usage')}</dt>
            <dd>
              <strong>{token.requestsUsed.toLocaleString()}</strong> /{' '}
              {token.requestsLimit.toLocaleString()} ({usagePct}%)
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.lastUsed')}</dt>
            <dd>
              {token.lastUsedAt
                ? formatDateTime(token.lastUsedAt, userTz)
                : t('profile.never')}
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.resetWindow')}</dt>
            <dd>
              {token.resetAt
                ? formatDateTime(token.resetAt, userTz)
                : t('profile.dash')}
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.created')}</dt>
            <dd>{formatDateTime(token.createdAt, userTz)}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="ghc-admin-section-title">{t('actionsHeading')}</h2>
        <TokenActions tokenId={token.id.toString()} currentStatus={token.status} />
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
