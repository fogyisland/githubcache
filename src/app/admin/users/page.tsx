import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { listUsers } from '@/lib/db/users';
import { listInvitations } from '@/lib/db/invitations';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminFilterBar } from '@/app/admin/_components/admin-filter-bar';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { InviteForm } from './_components/invite-form';
import type { User } from '@prisma/client';

/**
 * Admin → Users page (M7.1, M11.10 rewrite, M13.4 i18n).
 *
 * Three sections:
 *   1. Invite a user (client component)
 *   2. Existing users — AdminTable with role/status chips + filter bar
 *   3. Pending invitations — separate AdminTable with invite links
 *
 * Admin-only: enforces `user.role === 'admin'` and redirects to /admin
 * otherwise.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: { role?: string; status?: string };
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

  const t = await getTranslations('admin.users');

  const filterRole = searchParams.role === 'admin' || searchParams.role === 'operator'
    ? searchParams.role
    : undefined;
  const filterStatus = searchParams.status === 'active' || searchParams.status === 'disabled'
    ? searchParams.status
    : undefined;

  const allUsers = await listUsers();
  const filteredUsers = allUsers.filter(
    (u) =>
      (filterRole ? u.role === filterRole : true) &&
      (filterStatus ? u.status === filterStatus : true),
  );
  const invitations = await listInvitations();
  const pending = invitations.filter((i) => !i.consumedAt && i.expiresAt > new Date());

  const columns: AdminColumn<User>[] = [
    { key: 'email', header: t('list.column.email'), render: (u) => u.email },
    {
      key: 'role',
      header: t('list.column.role'),
      render: (u) => (
        <AdminStatusChip variant={u.role === 'admin' ? 'info' : 'neutral'}>
          {t(`role.${u.role}` as 'role.admin' | 'role.operator')}
        </AdminStatusChip>
      ),
    },
    {
      key: 'status',
      header: t('list.column.status'),
      render: (u) => (
        <AdminStatusChip variant={u.status === 'active' ? 'ok' : 'warn'}>
          {t(`status.${u.status}` as 'status.active' | 'status.disabled')}
        </AdminStatusChip>
      ),
    },
    {
      key: 'lastLogin',
      header: t('list.column.lastLogin'),
      render: (u) =>
        u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 10) : t('list.never'),
    },
    {
      key: 'created',
      header: t('list.column.created'),
      render: (u) => u.createdAt.toISOString().slice(0, 10),
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumbAdmin'), href: '/admin' },
          { label: t('breadcrumbUsers') },
        ]}
        title={t('title')}
        description={t('description')}
      />

      <section>
        <h2 className="ghc-admin-section-title">{t('list.inviteHeading')}</h2>
        <InviteForm />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          {t('list.existingHeading')}{' '}
          <span className="ghc-admin-section-count">({filteredUsers.length})</span>
        </h2>
        <AdminFilterBar
          filters={[
            {
              name: 'role',
              label: t('list.filter.role'),
              options: [
                { value: 'admin', label: t('role.admin') },
                { value: 'operator', label: t('role.operator') },
              ],
            },
            {
              name: 'status',
              label: t('list.filter.status'),
              options: [
                { value: 'active', label: t('status.active') },
                { value: 'disabled', label: t('status.disabled') },
              ],
            },
          ]}
          basePath="/admin/users"
          values={{
            ...(filterRole ? { role: filterRole } : {}),
            ...(filterStatus ? { status: filterStatus } : {}),
          }}
        />
        <AdminTable<User>
          columns={columns}
          rows={filteredUsers}
          rowHref={(u) => `/admin/users/${u.id}`}
          emptyTitle={t('list.empty.title')}
          emptyDescription={t('list.empty.description')}
          ariaLabel={t('list.ariaLabel')}
        />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          {t('list.pendingHeading')}{' '}
          <span className="ghc-admin-section-count">({pending.length})</span>
        </h2>
        <AdminTable
          columns={[
            { key: 'email', header: t('list.column.email'), render: (i) => i.email },
            {
              key: 'role',
              header: t('list.column.role'),
              render: (i) => (
                <AdminStatusChip variant={i.role === 'admin' ? 'info' : 'neutral'}>
                  {t(`role.${i.role}` as 'role.admin' | 'role.operator')}
                </AdminStatusChip>
              ),
            },
            {
              key: 'invitedBy',
              header: t('list.column.invitedBy'),
              render: (i) => `#${i.invitedBy}`,
            },
            {
              key: 'expires',
              header: t('list.column.expires'),
              render: (i) => i.expiresAt.toISOString().slice(0, 10),
            },
            {
              key: 'link',
              header: t('list.column.inviteLink'),
              render: (i) => (
                <code className="ghc-admin-invite-link">
                  {t('inviteLinkPrefix', { id: i.id })}
                </code>
              ),
            },
          ]}
          rows={pending}
          emptyTitle={t('list.pendingEmpty.title')}
          emptyDescription={t('list.pendingEmpty.description')}
          ariaLabel={t('list.pendingAriaLabel')}
        />
      </section>
    </div>
  );
}
