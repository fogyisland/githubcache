import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { getUserById } from '@/lib/db/users';
import { prisma } from '@/lib/db/client';
import { UserActions } from './_components/user-actions';

/**
 * Admin → User detail page (M7.1).
 *
 * Shows the user's profile (role / status / created / last-login) and
 * their current active session count. The `<UserActions>` client component
 * provides the three admin buttons (reset password, disable/enable, logout
 * all sessions).
 *
 * Admin-only: the surrounding `/admin/users` page is admin-gated, and any
 * link to this page only renders for admins (see nav in `layout.tsx`).
 */
export default async function AdminUserDetailPage({
  params,
}: {
  params: { id: string };
}): Promise<ReactElement> {
  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    notFound();
  }

  const user = await getUserById(id);
  if (!user) notFound();

  const sessionCount = await prisma.session.count({ where: { userId: id } });

  return (
    <div>
      <h1>{user.email}</h1>
      <dl>
        <dt>Role</dt>
        <dd>{user.role}</dd>
        <dt>Status</dt>
        <dd>{user.status}</dd>
        <dt>Created</dt>
        <dd>{user.createdAt.toISOString()}</dd>
        <dt>Last login</dt>
        <dd>{user.lastLoginAt?.toISOString() ?? 'never'}</dd>
        <dt>Active sessions</dt>
        <dd>{sessionCount}</dd>
      </dl>
      <UserActions userId={user.id.toString()} currentStatus={user.status} />
      <p>
        <a href="/admin/users">← Back to users</a>
      </p>
    </div>
  );
}
