'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

interface NavItem {
  href: string;
  key: 'overview' | 'keys' | 'password' | 'preferences' | 'adminCenter';
}

/**
 * M26 — sidebar nav for the /account section.
 *
 * Highlights the current section via `usePathname()`. Admins get an
 * extra "Admin center" link at the top — they have both a personal
 * center AND an admin role, so both surfaces should be reachable.
 */
export function AccountSidebar({ isAdmin = false }: { isAdmin?: boolean }): ReactElement {
  const pathname = usePathname() ?? '/account';
  const t = useTranslations('account.sidebar');

  const items: NavItem[] = [
    ...(isAdmin ? [{ href: '/admin', key: 'adminCenter' as const }] : []),
    { href: '/account', key: 'overview' },
    { href: '/account/keys', key: 'keys' },
    { href: '/account/password', key: 'password' },
    { href: '/account/preferences', key: 'preferences' },
  ];

  function isActive(href: string): boolean {
    if (href === '/account') return pathname === '/account';
    if (href === '/admin') return pathname.startsWith('/admin');
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav aria-label={t('aria')} className="ghc-account-sidebar">
      <ul className="ghc-account-sidebar-list">
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                data-active={active}
                className="ghc-account-sidebar-link"
              >
                {t(`items.${item.key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
