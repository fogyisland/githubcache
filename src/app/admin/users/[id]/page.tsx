import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import { validateSession } from '@/lib/auth/session';
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
 * Admin-only: this page enforces `user.role === 'admin'` and redirects to
 * /admin otherwise. The surrounding nav in `layout.tsx` also hides the link
 * from operators, but the redirect here is defense-in-depth in case of
 * direct URL access.
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
