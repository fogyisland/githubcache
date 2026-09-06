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
 */
export default async function AccountLayout({
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
    redirect('/login?next=/account');
  }

  const t = await getTranslations('account.layout');

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <p
            className="font-mono text-xs tracking-[0.2em] uppercase"
            style={{ color: 'var(--color-accent)' }}
          >
            {t('eyebrow')}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{t('title')}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
            {user.email}
          </span>
          <AccountLogoutButton />
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(11rem, 14rem) 1fr',
          gap: '1.5rem',
        }}
      >
        <aside>
          <AccountSidebar isAdmin={user.role === 'admin'} />
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
