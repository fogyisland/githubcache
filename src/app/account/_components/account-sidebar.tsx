'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

interface NavItem {
  href: string;
  key: 'overview' | 'keys' | 'password' | 'preferences';
}

/**
 * M26 — sidebar nav for the /account section.
 *
 * Highlights the current section via `usePathname()`. Items are
 * strictly inside /account/* — we don't expose admin links here
 * because the public account surface is a separate concern from
 * the admin shell.
 */
export function AccountSidebar(): ReactElement {
  const pathname = usePathname() ?? '/account';
  const t = useTranslations('account.sidebar');

  const items: NavItem[] = [
    { href: '/account', key: 'overview' },
    { href: '/account/keys', key: 'keys' },
    { href: '/account/password', key: 'password' },
    { href: '/account/preferences', key: 'preferences' },
  ];

  function isActive(href: string): boolean {
    if (href === '/account') return pathname === '/account';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav aria-label={t('aria')} className="ghc-account-sidebar">
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                style={{
                  display: 'block',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.375rem',
                  textDecoration: 'none',
                  background: active ? 'var(--color-accent-soft)' : 'transparent',
                  color: active ? 'var(--color-accent)' : 'var(--color-ink)',
                  fontWeight: active ? 600 : 400,
                }}
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
