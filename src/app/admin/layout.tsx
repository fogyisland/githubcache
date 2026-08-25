import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { validateSession } from '@/lib/auth/session';
import { LogoutButton } from '@/app/admin/logout-button';

/**
 * Layout for all /admin/* pages.
 *
 * Auth: the Edge middleware already redirects to /login when the session
 * cookie is absent, but that is only a cookie-presence check. This layout does
 * the full DB-backed `validateSession` (expiry, sliding renewal, user status)
 * and redirects to /login on failure. No CSRF check here — CSRF only applies
 * to state-changing API routes, not to GET page renders.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
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

  if (!user) {
    redirect('/login');
  }

  const isAdmin = user.role === 'admin';
  const isAdminOrOperator = isAdmin || user.role === 'operator';

  return (
    <div className="min-h-screen bg-gray-50">
      <nav
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1rem',
          borderBottom: '1px solid #ccc',
        }}
      >
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link href="/admin">Dashboard</Link>
          {isAdmin && <Link href="/admin/users">Users</Link>}
          {isAdminOrOperator && (
            // M7.2 ships this page — link target reserved
            <Link href="/admin/api-keys">API Keys</Link>
          )}
          {isAdminOrOperator && (
            // M7.3 ships this page — link target reserved
            <Link href="/admin/github-tokens">GitHub Tokens</Link>
          )}
          {(user.role === 'admin' || user.role === 'operator') && (
            <Link href="/admin/reports">Reports</Link>
          )}
          {user.role === 'admin' && <Link href="/admin/audit">Audit</Link>}
          {user.role === 'admin' && <Link href="/admin/refresh">Refresh</Link>}
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span>
            {user.email} ({user.role})
          </span>
          <LogoutButton />
        </div>
      </nav>
      <main style={{ padding: '1rem' }}>{children}</main>
    </div>
  );
}
