import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { LangSwitcher } from '@/app/_components/lang-switcher';
import { TimezoneSwitcher } from '@/app/_components/timezone-switcher';
import { shouldHideSiteHeader } from '@/app/_components/site-header-visibility';
import { readLangFromCookieHeader } from '@/lib/lang/cookie';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';
import { resolveLocale, LOCALES } from '@/lib/lang/registry';
import { SITE_NAME } from '@/lib/config/site';
import { validateSession } from '@/lib/auth/session';
import { MobileNav } from './mobile-nav';
import { AccountMenu } from './account-menu';

/**
 * Top navigation bar. Sticky, theme-aware.
 *
 * Layout:
 *   - left:  logo
 *   - middle (≥ 1024px): nav links (Lookup / Docs / Status)
 *   - right (≥ 1024px): TZ / Lang / Login | AccountMenu
 *   - < 1024px: MobileNav hamburger on the right
 *
 * Pure server component; reads cookies + session once, passes primitives
 * down to the (client) MobileNav + AccountMenu.
 */
export async function SiteHeader() {
  const headerStore = await headers();
  // The /admin shell has its own top utility bar. Rendering SiteHeader
  // here produces two top bars with misaligned inner edges (max-w-6xl
  // vs 100% width) — see shouldHideSiteHeader for the full rationale.
  if (shouldHideSiteHeader(headerStore.get('x-pathname'))) {
    return null;
  }
  const cookieHeader = headerStore.get('cookie') ?? null;
  const currentLang = resolveLocale({
    cookieValue: readLangFromCookieHeader(cookieHeader),
    acceptLanguage: headerStore.get('accept-language'),
  });
  const t = await getTranslations('nav');

  const cookieStore = await cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const session = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  const currentTimezone = await resolveRequestTimezone({
    dbValue: session?.timezone ?? null,
  });
  const isAdmin = session?.role === 'admin';
  const isLoggedIn = session !== null;
  const userEmail = session?.email ?? '';

  const navLinks = [
    { href: '/get-started', label: t('apiGuide'), ariaLabel: t('apiGuideAria') },
    { href: '/status', label: t('status'), ariaLabel: t('statusAria') },
  ];

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

        {/* Desktop nav (≥ 1024px) */}
        <nav className="ghc-desktop-nav">
          {navLinks.map((l) => (
            <Link key={l.href} href={l.href} className="ghc-header-util-link" aria-label={l.ariaLabel}>
              {l.label}
            </Link>
          ))}
          <TimezoneSwitcher current={currentTimezone} />
          <LangSwitcher current={currentLang} locales={LOCALES} />
          {isLoggedIn ? (
            <AccountMenu email={userEmail} isAdmin={isAdmin} logoutHref="/api/admin/auth/logout" />
          ) : (
            <Link href="/login" className="ghc-btn-secondary ghc-btn-sm">
              {t('login')}
            </Link>
          )}
        </nav>

        {/* Mobile nav (< 1024px) */}
        <MobileNav
          links={navLinks}
          accountLabel={isLoggedIn ? t('account') : t('login')}
          accountHref={isLoggedIn ? '/account' : '/login'}
          loggedInLabel={t('login')}
        />
      </div>
    </header>
  );
}
