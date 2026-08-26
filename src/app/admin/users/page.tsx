import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
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
 * Admin → Users page (M7.1, M11.10 rewrite).
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
    { key: 'email', header: 'Email', render: (u) => u.email },
    {
      key: 'role',
      header: 'Role',
      render: (u) => (
        <AdminStatusChip variant={u.role === 'admin' ? 'info' : 'neutral'}>
          {u.role}
        </AdminStatusChip>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) => (
        <AdminStatusChip variant={u.status === 'active' ? 'ok' : 'warn'}>
          {u.status}
        </AdminStatusChip>
      ),
    },
    {
      key: 'lastLogin',
      header: 'Last login',
      render: (u) =>
        u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 10) : '—',
    },
    {
      key: 'created',
      header: 'Created',
      render: (u) => u.createdAt.toISOString().slice(0, 10),
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[{ label: 'Admin', href: '/admin' }, { label: 'Users' }]}
        title="Users"
        description="Manage operators, admins, and pending invitations."
      />

      <section>
        <h2 className="ghc-admin-section-title">Invite a user</h2>
        <InviteForm />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          Existing users{' '}
          <span className="ghc-admin-section-count">({filteredUsers.length})</span>
        </h2>
        <AdminFilterBar
          filters={[
            {
              name: 'role',
              label: 'Role',
              options: [
                { value: 'admin', label: 'Admin' },
                { value: 'operator', label: 'Operator' },
              ],
            },
            {
              name: 'status',
              label: 'Status',
              options: [
                { value: 'active', label: 'Active' },
                { value: 'disabled', label: 'Disabled' },
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
          emptyTitle="No users match these filters"
          emptyDescription="Try clearing one of the filters above."
          ariaLabel="Existing users"
        />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          Pending invitations{' '}
          <span className="ghc-admin-section-count">({pending.length})</span>
        </h2>
        <AdminTable
          columns={[
            { key: 'email', header: 'Email', render: (i) => i.email },
            {
              key: 'role',
              header: 'Role',
              render: (i) => (
                <AdminStatusChip variant={i.role === 'admin' ? 'info' : 'neutral'}>
                  {i.role}
                </AdminStatusChip>
              ),
            },
            { key: 'invitedBy', header: 'Invited by', render: (i) => `#${i.invitedBy}` },
            {
              key: 'expires',
              header: 'Expires',
              render: (i) => i.expiresAt.toISOString().slice(0, 10),
            },
            {
              key: 'link',
              header: 'Invite link',
              render: (i) => (
                <code className="ghc-admin-invite-link">
                  /request-access?invitation={i.id}
                </code>
              ),
            },
          ]}
          rows={pending}
          emptyTitle="No pending invitations"
          emptyDescription="Send one with the form above to get started."
          ariaLabel="Pending invitations"
        />
      </section>
    </div>
  );
}