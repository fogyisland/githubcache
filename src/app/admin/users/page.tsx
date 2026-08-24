import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import { validateSession } from '@/lib/auth/session';
import { listUsers } from '@/lib/db/users';
import { listInvitations } from '@/lib/db/invitations';
import { InviteForm } from './_components/invite-form';

/**
 * Admin → Users page (M7.1).
 *
 * Three sections:
 *   1. Invite a user (client component)
 *   2. Existing users (table with role / status / last-login / actions)
 *   3. Pending invitations (table with invite links)
 *
 * Admin-only: enforces `user.role === 'admin'` and redirects to /admin
 * otherwise. Defense-in-depth — the nav in `layout.tsx` also hides the
 * link from operators, but the redirect here catches direct URL access.
 *
 * TODO(M7): The /request-access page that consumes invitation links is
 * deferred to a later round. Admins copy/paste the invite link and send
 * it manually (email, Slack, etc.) until that UX lands.
 */
export default async function AdminUsersPage(): Promise<ReactElement> {
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

  const users = await listUsers();
  const invitations = await listInvitations();
  const pending = invitations.filter((i) => !i.consumedAt && i.expiresAt > new Date());

  return (
    <div>
      <h1>Users</h1>

      <h2>Invite a user</h2>
      <InviteForm />

      <h2>Existing users</h2>
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Last login</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id.toString()}>
              <td>
                <a href={`/admin/users/${u.id}`}>{u.email}</a>
              </td>
              <td>{u.role}</td>
              <td>{u.status}</td>
              <td>{u.lastLoginAt?.toISOString() ?? '—'}</td>
              <td>{u.createdAt.toISOString()}</td>
              <td>
                <a href={`/admin/users/${u.id}`}>Manage</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Pending invitations</h2>
      {pending.length === 0 ? (
        <p>None.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Invited by</th>
              <th>Expires</th>
              <th>Invite link</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((i) => (
              <tr key={i.id}>
                <td>{i.email}</td>
                <td>{i.role}</td>
                <td>{i.invitedBy.toString()}</td>
                <td>{i.expiresAt.toISOString()}</td>
                <td>
                  <code>/request-access?invitation={i.id}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
