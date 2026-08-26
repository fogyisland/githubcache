import Link from 'next/link';
import type { ReactElement } from 'react';

export type AdminSectionSlug =
  | 'dashboard'
  | 'users'
  | 'api-keys'
  | 'github-tokens'
  | 'reports'
  | 'audit'
  | 'refresh';

export interface AdminSection {
  slug: AdminSectionSlug;
  title: string;
  icon: string;
  href: string;
  /** Role names (from the Prisma `Role` enum) allowed to see this section. */
  roles: Array<'admin' | 'operator'>;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { slug: 'dashboard', title: 'Dashboard', icon: '◉', href: '/admin', roles: ['admin', 'operator'] },
  { slug: 'users', title: 'Users', icon: '◐', href: '/admin/users', roles: ['admin'] },
  { slug: 'api-keys', title: 'API Keys', icon: '⌬', href: '/admin/api-keys', roles: ['admin', 'operator'] },
  { slug: 'github-tokens', title: 'GitHub Tokens', icon: '⊕', href: '/admin/github-tokens', roles: ['admin', 'operator'] },
  { slug: 'reports', title: 'Reports', icon: '⊟', href: '/admin/reports', roles: ['admin', 'operator'] },
  { slug: 'audit', title: 'Audit', icon: '◭', href: '/admin/audit', roles: ['admin'] },
  { slug: 'refresh', title: 'Refresh', icon: '↻', href: '/admin/refresh', roles: ['admin'] },
];

interface Props {
  /** Slug of the current section (drives the indicator). */
  current: AdminSectionSlug;
  /** Operator's role — gates visibility of admin-only sections. */
  userRole: 'admin' | 'operator';
}

/**
 * Admin sidebar. Renders one `<Link>` per section the operator can see.
 * The active section gets `ghc-admin-sidebar-current` for the left-border
 * accent. Designed to live in a fixed-width (240px) column on desktop.
 */
export function AdminSidebar({ current, userRole }: Props): ReactElement {
  const visible = ADMIN_SECTIONS.filter((s) => s.roles.includes(userRole));
  return (
    <nav className="ghc-admin-sidebar" aria-label="Admin sections">
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
                <span className="ghc-admin-sidebar-title">{s.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}