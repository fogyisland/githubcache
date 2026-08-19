import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import { validateSession } from '@/lib/auth/session';

/**
 * Admin dashboard placeholder.
 *
 * The layout already guarantees a valid session (it redirects otherwise), so
 * this page re-reads the session only to display the current user. M7 replaces
 * this with the real dashboard (KPI cards, key management, user CRUD, reports).
 */
export default async function AdminDashboardPage(): Promise<ReactElement> {
  const cookieStore = cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const user = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });

  return (
    <div>
      <h1>Dashboard</h1>
      <p>
        Logged in as: <strong>{user?.email ?? 'unknown'}</strong> ({user?.role ?? 'unknown'})
      </p>
      <p>
        <em>Full admin UI (KPI cards, key management, user CRUD, reports) arrives in M7.</em>
      </p>
      <h2>Quick links</h2>
      <ul>
        <li>
          <a href="/api/v1/status">Public status endpoint</a>
        </li>
      </ul>
    </div>
  );
}
