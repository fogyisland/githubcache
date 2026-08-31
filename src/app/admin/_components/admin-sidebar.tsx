import Link from 'next/link';
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

export type AdminSectionSlug =
  | 'dashboard'
  | 'users'
  | 'api-keys'
  | 'github-tokens'
  | 'reports'
  | 'queries'
  | 'ingestion'
  | 'audit'
  | 'refresh'
  | 'webhooks'
  | 'database';

/** Static metadata — `title` lives in messages, not here, so it can translate. */
export interface AdminSection {
  slug: AdminSectionSlug;
  icon: string;
  href: string;
  roles: Array<'admin' | 'operator'>;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { slug: 'dashboard', icon: '◉', href: '/admin', roles: ['admin', 'operator'] },
  { slug: 'users', icon: '◐', href: '/admin/users', roles: ['admin'] },
  { slug: 'api-keys', icon: '⌬', href: '/admin/api-keys', roles: ['admin', 'operator'] },
  { slug: 'github-tokens', icon: '⊕', href: '/admin/github-tokens', roles: ['admin', 'operator'] },
  { slug: 'reports', icon: '⊟', href: '/admin/reports', roles: ['admin', 'operator'] },
  { slug: 'queries', icon: '⊰', href: '/admin/queries', roles: ['admin', 'operator'] },
  { slug: 'ingestion', icon: '⊱', href: '/admin/ingestion', roles: ['admin'] },
  { slug: 'audit', icon: '◭', href: '/admin/audit', roles: ['admin'] },
  { slug: 'refresh', icon: '↻', href: '/admin/refresh', roles: ['admin'] },
  { slug: 'webhooks', icon: '⊜', href: '/admin/webhooks', roles: ['admin'] },
  { slug: 'database', icon: '◰', href: '/admin/database', roles: ['admin'] },
];

interface Props {
  current: AdminSectionSlug;
  userRole: 'admin' | 'operator';
}

export async function AdminSidebar({ current, userRole }: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.shell');
  const visible = ADMIN_SECTIONS.filter((s) => s.roles.includes(userRole));
  return (
    <nav className="ghc-admin-sidebar" aria-label={t('sidebarAria')}>
      <ul className="ghc-admin-sidebar-list">
        {visible.map((s) => {
          const isCurrent = s.slug === current;
          return (
            <li key={s.slug} className="ghc-admin-sidebar-item">
              <Link
                href={s.href}
                className={
                  isCurrent
                    ? 'ghc-admin-sidebar-link ghc-admin-sidebar-current'
                    : 'ghc-admin-sidebar-link'
                }
                aria-current={isCurrent ? 'page' : undefined}
              >
                <span className="ghc-admin-sidebar-icon" aria-hidden="true">
                  {s.icon}
                </span>
                <span className="ghc-admin-sidebar-title">{t(`sections.${s.slug}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
