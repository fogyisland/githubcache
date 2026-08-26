import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import { getTokenById } from '@/lib/db/github-tokens';
import { poolHasHash } from '@/lib/github/pool';
import { validateSession } from '@/lib/auth/session';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { TokenActions } from '../_components/token-actions';
import { queryAuditLog } from '@/lib/db/audit';

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
  params: { id: string };
}): Promise<ReactElement> {
  const cookieStore = cookies();
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

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    notFound();
  }

  const token = await getTokenById(id);
  if (!token) notFound();

  const inPool = poolHasHash(token.tokenHash);
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
          { label: 'GitHub Tokens', href: '/admin/github-tokens' },
          { label: token.label },
        ]}
        title={token.label}
        description={`Token ${token.tokenFirst4}…${token.tokenLast4}`}
      />

      <section className="ghc-admin-detail-card">
        <dl className="ghc-admin-detail-dl">
          <div className="ghc-admin-detail-row">
            <dt>Prefix</dt>
            <dd>
              <code className="ghc-admin-mono">
                {token.tokenFirst4}…{token.tokenLast4}
              </code>{' '}
              <span className="ghc-admin-detail-hint">(full token never stored)</span>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Status</dt>
            <dd>
              <AdminStatusChip variant={token.status === 'active' ? 'ok' : 'warn'}>
                {token.status}
              </AdminStatusChip>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Pool state</dt>
            <dd>
              <AdminStatusChip variant={inPool ? 'ok' : 'warn'}>
                {inPool ? 'in pool' : 'pending activation'}
              </AdminStatusChip>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Usage</dt>
            <dd>
              <strong>{token.requestsUsed.toLocaleString()}</strong> /{' '}
              {token.requestsLimit.toLocaleString()} ({usagePct}%)
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Last used</dt>
            <dd>
              {token.lastUsedAt
                ? token.lastUsedAt.toISOString().replace('T', ' ').slice(0, 19)
                : 'never'}
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Reset window</dt>
            <dd>
              {token.resetAt
                ? token.resetAt.toISOString().replace('T', ' ').slice(0, 19)
                : '—'}
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Created</dt>
            <dd>{token.createdAt.toISOString().replace('T', ' ').slice(0, 19)}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="ghc-admin-section-title">Actions</h2>
        <TokenActions tokenId={token.id.toString()} currentStatus={token.status} />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          Recent activity{' '}
          <span className="ghc-admin-section-count">({recentAudit.total})</span>
        </h2>
        <AdminTable<AuditRow>
          columns={auditColumns}
          rows={recentAudit.rows}
          emptyTitle="No recent activity for this token"
          ariaLabel="Recent audit entries for this GitHub token"
        />
      </section>
    </div>
  );
}