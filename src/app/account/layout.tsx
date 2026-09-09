import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement, ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { AccountSidebar } from './_components/account-sidebar';
import { AccountLogoutButton } from './_components/account-logout-button';

/**
 * M26 — layout for /account/* (user center).
 *
 * Reads the session from cookies and redirects to /login if absent.
 * (We intentionally don't rely on a middleware check here — the
 * login page is the canonical landing for unauthenticated visitors
 * and the layout is the only authoritative gate on /account.)
 *
 * Renders a left sidebar (AccountSidebar client component) + a top
 * header strip with the user's email + logout button. The page
 * children render in the right-hand content column.
 *
 * M26.x — chrome uses ghc-* classes (ghc-page, ghc-eyebrow,
 * ghc-account-grid, ghc-text-muted) for theming instead of inlining
 * the same color tokens on every page.
 */
export default async function AccountLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const cookieStore = await cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const user = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!user) {
    redirect('/login?next=/account');
  }

  const t = await getTranslations('account.layout');

  return (
    <div className="ghc-page mx-auto max-w-6xl px-4 py-10">
      <header className="ghc-account-header">
        <div>
          <p className="ghc-eyebrow">{t('eyebrow')}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t('title')}</h1>
        </div>
        <div className="ghc-account-header-actions">
          <span className="text-sm ghc-text-muted">{user.email}</span>
          <AccountLogoutButton />
        </div>
      </header>

      <div className="ghc-account-grid">
        <aside>
          <AccountSidebar isAdmin={user.role === 'admin'} />
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
