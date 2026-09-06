import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { ThemeSwitcher } from '@/app/_components/theme-switcher';
import { LangSwitcher } from '@/app/_components/lang-switcher';
import { readThemeFromCookieHeader } from '@/lib/theme/cookie';
import { readLangFromCookieHeader } from '@/lib/lang/cookie';
import { resolveLocale, LOCALES } from '@/lib/lang/registry';
import { SITE_NAME } from '@/lib/config/site';
import { validateSession } from '@/lib/auth/session';

/**
 * Top navigation bar. Sticky, theme-aware, with brand logo on the left,
 * Status/Admin links + theme switcher + lang switcher on the right.
 *
 * Pure server component: reads the cookie via next/headers and passes the
 * current theme id down to the (client) ThemeSwitcher so it can render the
 * active pill, and the current locale to the (client) LangSwitcher.
 *
 * M26 — the rightmost nav area shows different links based on session:
 *   - anon: a single "Log in" link → /login
 *   - operator: a single "My account" link → /account
 *   - admin: BOTH "Admin center" → /admin AND "My account" → /account
 *     (admins also have a personal center — they're operators too, just
 *     with extra privileges — so both links are surfaced).
 *
 * The session check is a cookie-presence-only lookup via validateSession
 * — the DB hit is fine on a static-header render and we avoid the
 * complexity of a middleware-based redirect here.
 */
export async function SiteHeader() {
  const headerStore = headers();
  const cookieHeader = headerStore.get('cookie') ?? null;
  const currentTheme = readThemeFromCookieHeader(cookieHeader);
  const currentLang = resolveLocale({
    cookieValue: readLangFromCookieHeader(cookieHeader),
    acceptLanguage: headerStore.get('accept-language'),
  });
  const t = await getTranslations('nav');

  const cookieStore = cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const session = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  const isAdmin = session?.role === 'admin';
  const isLoggedIn = session !== null;

  return (
    <header className="ghc-site-header sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-accent-ink)]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
          </span>
          <span className="text-base">{SITE_NAME}</span>
        </Link>
        <nav className="flex items-center gap-3">
          <LangSwitcher current={currentLang} locales={LOCALES} />
          <ThemeSwitcher current={currentTheme} />
          <Link href="/get-started" className="ghc-header-util-link">
            {t('apiGuide')}
          </Link>
          <Link href="/api/v1/status" className="ghc-header-util-link" aria-label={t('statusAria')}>
            {t('status')}
          </Link>
          {isAdmin && (
            <Link href="/admin" className="ghc-header-util-link" aria-label={t('adminAria')}>
              {t('admin')}
            </Link>
          )}
          <Link
            href={isLoggedIn ? '/account' : '/login'}
            className="ghc-header-util-link"
            aria-label={isLoggedIn ? t('accountAria') : t('adminAria')}
          >
            {isLoggedIn ? t('account') : t('login')}
          </Link>
        </nav>
      </div>
    </header>
  );
}
