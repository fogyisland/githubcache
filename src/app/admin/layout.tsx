import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { validateSession } from '@/lib/auth/session';
import { LogoutButton } from '@/app/admin/logout-button';
import { ThemeSwitcher } from '@/app/_components/theme-switcher';
import { AdminVariantSwitcher } from '@/app/_components/admin-variant-switcher';
import { readThemeFromCookieHeader } from '@/lib/theme/cookie';
import { readAdminVariantFromCookieHeader } from '@/lib/admin/cookie';

/**
 * Layout for all /admin/* pages.
 *
 * Auth: the Edge middleware already redirects to /login when the session
 * cookie is absent, but that is only a cookie-presence check. This layout does
 * the full DB-backed `validateSession` (expiry, sliding renewal, user status)
 * and redirects to /login on failure. No CSRF check here — CSRF only applies
 * to state-changing API routes, not to GET page renders.
 *
 * Styling: admin chrome re-uses the theme tokens via `ghc-*` classes so the
 * admin app picks up the same theme the operator chose on the public surface.
 * M11 adds the admin variant switcher (mission_control / inspector / workbench);
 * the actual `[data-admin]` chrome lands in M11.6.
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

  // Theme cookie for the admin chrome — admin pages are inside the same
  // <html data-theme> as the public surface, so we just read the same value.
  const currentTheme = readThemeFromCookieHeader(cookieStore.get('cookie')?.value ?? null);
  const currentAdminVariant = readAdminVariantFromCookieHeader(
    cookieStore.get('cookie')?.value ?? null,
  );

  return (
    <div data-admin={currentAdminVariant}>
      <nav className="ghc-card flex flex-wrap items-center justify-between gap-2 border-x-0 border-t-0 rounded-none px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin" className="ghc-btn-ghost">
            Dashboard
          </Link>
          {isAdmin && (
            <Link href="/admin/users" className="ghc-btn-ghost">
              Users
            </Link>
          )}
          {isAdminOrOperator && (
            <Link href="/admin/api-keys" className="ghc-btn-ghost">
              API Keys
            </Link>
          )}
          {isAdminOrOperator && (
            <Link href="/admin/github-tokens" className="ghc-btn-ghost">
              GitHub Tokens
            </Link>
          )}
          {(user.role === 'admin' || user.role === 'operator') && (
            <Link href="/admin/reports" className="ghc-btn-ghost">
              Reports
            </Link>
          )}
          {user.role === 'admin' && (
            <Link href="/admin/audit" className="ghc-btn-ghost">
              Audit
            </Link>
          )}
          {user.role === 'admin' && (
            <Link href="/admin/refresh" className="ghc-btn-ghost">
              Refresh
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <AdminVariantSwitcher current={currentAdminVariant} />
          <ThemeSwitcher current={currentTheme} />
          <span className="text-sm">
            {user.email} ({user.role})
          </span>
          <LogoutButton />
        </div>
      </nav>
      <main className="p-4">{children}</main>
    </div>
  );
}