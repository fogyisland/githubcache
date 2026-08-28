import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { getUserById } from '@/lib/db/users';
import { prisma } from '@/lib/db/client';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { UserActions } from './_components/user-actions';
import { queryAuditLog } from '@/lib/db/audit';

interface KeyRow {
  id: bigint;
  name: string;
  keyPrefix: string;
  status: string;
  createdAt: Date;
}

interface AuditRow {
  id: bigint;
  action: string;
  createdAt: Date;
}

/**
 * Admin → User detail page (M7.1, M11.11 rewrite, M13.4 i18n).
 *
 * Sections:
 *   1. AdminPageHeader with email + role/status chips
 *   2. Profile dl: role / status / created / last login / active sessions
 *   3. UserActions (reset pw, enable/disable, logout-all)
 *   4. Keys owned (AdminTable)
 *   5. Recent audit trail (top 10)
 */
export default async function AdminUserDetailPage({
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

  const t = await getTranslations('admin.users.detail');

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    notFound();
  }

  const user = await getUserById(id);
  if (!user) notFound();

  const [sessionCount, ownedKeys, recentAudit] = await Promise.all([
    prisma.session.count({ where: { userId: id } }),
    prisma.apiKey.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, keyPrefix: true, status: true, createdAt: true },
    }),
    queryAuditLog({ actorUserId: id, limit: 10, offset: 0 }),
  ]);

  const keyColumns: AdminColumn<KeyRow>[] = [
    { key: 'name', header: t('keyColumns.name'), render: (k) => k.name },
    {
      key: 'prefix',
      header: t('keyColumns.prefix'),
      render: (k) => <code className="ghc-admin-mono">{k.keyPrefix}…</code>,
    },
    {
      key: 'status',
      header: t('keyColumns.status'),
      render: (k) => (
        <AdminStatusChip
          variant={k.status === 'active' ? 'ok' : k.status === 'pending' ? 'warn' : 'danger'}
        >
          {t(`status.${k.status}` as 'status.active' | 'status.pending' | 'status.disabled')}
        </AdminStatusChip>
      ),
    },
    {
      key: 'created',
      header: t('keyColumns.created'),
      render: (k) => k.createdAt.toISOString().slice(0, 10),
    },
  ];

  const auditColumns: AdminColumn<AuditRow>[] = [
    {
      key: 'time',
      header: t('auditColumns.when'),
      render: (r) => r.createdAt.toISOString().replace('T', ' ').slice(0, 19),
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
          { label: t('breadcrumbUsers'), href: '/admin/users' },
          { label: user.email },
        ]}
        title={user.email}
        description={t('description')}
      />

      <section className="ghc-admin-detail-card">
        <dl className="ghc-admin-detail-dl">
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.role')}</dt>
            <dd>
              <AdminStatusChip variant={user.role === 'admin' ? 'info' : 'neutral'}>
                {t(`role.${user.role}` as 'role.admin' | 'role.operator')}
              </AdminStatusChip>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.status')}</dt>
            <dd>
              <AdminStatusChip variant={user.status === 'active' ? 'ok' : 'warn'}>
                {t(`status.${user.status}` as 'status.active' | 'status.disabled')}
              </AdminStatusChip>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.created')}</dt>
            <dd>{user.createdAt.toISOString().slice(0, 10)}</dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.lastLogin')}</dt>
            <dd>
              {user.lastLoginAt
                ? user.lastLoginAt.toISOString().replace('T', ' ').slice(0, 19)
                : t('profile.never')}
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.activeSessions')}</dt>
            <dd>{sessionCount.toLocaleString()}</dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.adminVariant')}</dt>
            <dd>
              <code className="ghc-admin-mono">{user.adminVariant}</code>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>{t('profile.theme')}</dt>
            <dd>
              <code className="ghc-admin-mono">{user.theme}</code>
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="ghc-admin-section-title">{t('actionsHeading')}</h2>
        <UserActions userId={user.id.toString()} currentStatus={user.status} />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          {t('keysHeading')}{' '}
          <span className="ghc-admin-section-count">({ownedKeys.length})</span>
        </h2>
        <AdminTable<KeyRow>
          columns={keyColumns}
          rows={ownedKeys}
          rowHref={(k) => `/admin/api-keys/${k.id}`}
          emptyTitle={t('keysEmpty.title')}
          emptyDescription={t('keysEmpty.description')}
          ariaLabel={t('keysAriaLabel')}
        />
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
