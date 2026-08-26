import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
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
 * Admin → User detail page (M7.1, M11.11 rewrite).
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
    { key: 'name', header: 'Name', render: (k) => k.name },
    {
      key: 'prefix',
      header: 'Prefix',
      render: (k) => <code className="ghc-admin-mono">{k.keyPrefix}…</code>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (k) => (
        <AdminStatusChip
          variant={k.status === 'active' ? 'ok' : k.status === 'pending' ? 'warn' : 'danger'}
        >
          {k.status}
        </AdminStatusChip>
      ),
    },
    {
      key: 'created',
      header: 'Created',
      render: (k) => k.createdAt.toISOString().slice(0, 10),
    },
  ];

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
          { label: 'Users', href: '/admin/users' },
          { label: user.email },
        ]}
        title={user.email}
        description="Operator profile, owned keys, and recent activity."
      />

      <section className="ghc-admin-detail-card">
        <dl className="ghc-admin-detail-dl">
          <div className="ghc-admin-detail-row">
            <dt>Role</dt>
            <dd>
              <AdminStatusChip variant={user.role === 'admin' ? 'info' : 'neutral'}>
                {user.role}
              </AdminStatusChip>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Status</dt>
            <dd>
              <AdminStatusChip variant={user.status === 'active' ? 'ok' : 'warn'}>
                {user.status}
              </AdminStatusChip>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Created</dt>
            <dd>{user.createdAt.toISOString().slice(0, 10)}</dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Last login</dt>
            <dd>
              {user.lastLoginAt
                ? user.lastLoginAt.toISOString().replace('T', ' ').slice(0, 19)
                : 'never'}
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Active sessions</dt>
            <dd>{sessionCount.toLocaleString()}</dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Admin variant</dt>
            <dd>
              <code className="ghc-admin-mono">{user.adminVariant}</code>
            </dd>
          </div>
          <div className="ghc-admin-detail-row">
            <dt>Theme</dt>
            <dd>
              <code className="ghc-admin-mono">{user.theme}</code>
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="ghc-admin-section-title">Actions</h2>
        <UserActions userId={user.id.toString()} currentStatus={user.status} />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          API keys owned{' '}
          <span className="ghc-admin-section-count">({ownedKeys.length})</span>
        </h2>
        <AdminTable<KeyRow>
          columns={keyColumns}
          rows={ownedKeys}
          rowHref={(k) => `/admin/api-keys/${k.id}`}
          emptyTitle="No API keys"
          emptyDescription="This user has not been issued any keys."
          ariaLabel="API keys owned"
        />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          Recent activity{' '}
          <span className="ghc-admin-section-count">({recentAudit.total})</span>
        </h2>
        <AdminTable<AuditRow>
          columns={auditColumns}
          rows={recentAudit.rows}
          emptyTitle="No recent activity"
          ariaLabel="Recent audit entries for this user"
        />
      </section>
    </div>
  );
}