'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactElement } from 'react';
import { SidebarIcon, type SidebarIconName } from '@/app/_components/sidebar-icons';

export type AdminSectionSlug =
  | 'dashboard'
  | 'users'
  | 'api-keys'
  | 'github-tokens'
  | 'reports'
  | 'queries'
  | 'ingestion'
  | 'providers'
  | 'repositories'
  | 'audit'
  | 'refresh'
  | 'queue'
  | 'webhooks'
  | 'database'
  | 'api-settings'
  | 'insights'
  | 'email'
  | 'email-log';

/** Static metadata — `title` lives in messages, not here, so it can translate. */
export interface AdminSection {
  slug: AdminSectionSlug;
  icon: SidebarIconName;
  href: string;
  roles: Array<'admin' | 'operator'>;
}

/**
 * Section registry keyed by slug. Order is NOT preserved here — callers
 * that need a specific render order use `ADMIN_GROUPS` (defined below).
 *
 * M30.8 — converted from `AdminSection[]` to `Record<AdminSectionSlug, AdminSection>`
 * so group definitions can look up sections by slug. `palette-loader.ts`
 * uses `Object.values()` to recover the flat list.
 */
export const ADMIN_SECTIONS: Record<AdminSectionSlug, AdminSection> = {
  dashboard:      { slug: 'dashboard',      icon: 'dashboard',      href: '/admin',              roles: ['admin', 'operator'] },
  users:          { slug: 'users',          icon: 'users',          href: '/admin/users',        roles: ['admin'] },
  'api-keys':     { slug: 'api-keys',       icon: 'api-keys',       href: '/admin/api-keys',     roles: ['admin', 'operator'] },
  'github-tokens':{ slug: 'github-tokens',  icon: 'github-tokens',  href: '/admin/github-tokens',roles: ['admin', 'operator'] },
  reports:        { slug: 'reports',        icon: 'reports',        href: '/admin/reports',      roles: ['admin', 'operator'] },
  queries:        { slug: 'queries',        icon: 'queries',        href: '/admin/queries',      roles: ['admin', 'operator'] },
  ingestion:      { slug: 'ingestion',      icon: 'ingestion',      href: '/admin/ingestion',    roles: ['admin'] },
  providers:      { slug: 'providers',      icon: 'providers',      href: '/admin/providers',    roles: ['admin'] },
  repositories:   { slug: 'repositories',   icon: 'repositories',   href: '/admin/repositories', roles: ['admin', 'operator'] },
  audit:          { slug: 'audit',          icon: 'audit',          href: '/admin/audit',        roles: ['admin'] },
  refresh:        { slug: 'refresh',        icon: 'refresh',        href: '/admin/refresh',      roles: ['admin'] },
  queue:          { slug: 'queue',          icon: 'queue',          href: '/admin/queue',        roles: ['admin'] },
  webhooks:       { slug: 'webhooks',       icon: 'webhooks',       href: '/admin/webhooks',     roles: ['admin'] },
  database:       { slug: 'database',       icon: 'database',       href: '/admin/database',     roles: ['admin'] },
  'api-settings': { slug: 'api-settings',   icon: 'queries',        href: '/admin/api-settings', roles: ['admin'] },
  insights:       { slug: 'insights',       icon: 'insights',       href: '/admin/insights',     roles: ['admin'] },
  // M25 — SMTP config + send log. Admin only because misconfiguration
  // can leak credentials to attackers who phish the form.
  email:          { slug: 'email',          icon: 'email',          href: '/admin/email',        roles: ['admin'] },
  'email-log':    { slug: 'email-log',      icon: 'email-log',      href: '/admin/email/log',    roles: ['admin'] },
};

export type AdminGroupSlug = 'overview' | 'access' | 'data' | 'operations' | 'system';

export interface AdminGroup {
  slug: AdminGroupSlug;
  /** Render order inside the group. */
  slugs: AdminSectionSlug[];
  /** Group-level role filter. A group the user can't see is rendered with `hidden`. */
  roles: Array<'admin' | 'operator'>;
}

/**
 * Sidebar groups. M30.8 — admin sidebar previously rendered 18 flat
 * `<li>` items, which made it hard to scan. We group them into 5
 * functional buckets. `palette-loader.ts` flattens this back to a flat
 * list (groups are sidebar-only).
 *
 * Group `roles` is a coarse gate; per-section `roles` is still consulted
 * before rendering each link, so admin-only sections like `users` are
 * hidden from operators even when the group is visible.
 */
export const ADMIN_GROUPS: AdminGroup[] = [
  { slug: 'overview',   slugs: ['dashboard'],                                          roles: ['admin', 'operator'] },
  { slug: 'access',     slugs: ['users', 'api-keys', 'github-tokens'],               roles: ['admin', 'operator'] },
  { slug: 'data',       slugs: ['repositories', 'ingestion', 'providers'],           roles: ['admin', 'operator'] },
  { slug: 'operations', slugs: ['refresh', 'queue', 'webhooks', 'audit'],             roles: ['admin'] },
  { slug: 'system',     slugs: ['database', 'api-settings', 'insights', 'email', 'email-log', 'reports', 'queries'], roles: ['admin'] },
];

/**
 * Pick the active sidebar slug from the current pathname. Returns
 * 'dashboard' as the fallback for any unrecognised admin path.
 *
 * M30 — moved out of `layout.tsx` (where it ran server-side and broke
 * on client-side navigation: the server-rendered highlight was right
 * for the initial page, but soft-nav to a sub-page didn't update
 * anything because the server never re-rendered). Now the sidebar
 * itself derives its active section from `usePathname()`.
 *
 * M28.bug-fix: prefer exact match immediately; among prefix matches,
 * keep the longest href (most specific section wins). Sub-pages like
 * `/admin/email/log` therefore match `email` (not `dashboard`).
 */
export function sectionFromPath(pathname: string): AdminSectionSlug {
  if (pathname === '/admin' || pathname === '/admin/') return 'dashboard';
  const candidates = Object.values(ADMIN_SECTIONS).filter((s) => s.slug !== 'dashboard');
  let best: AdminSection | null = null;
  for (const s of candidates) {
    if (pathname === s.href) return s.slug;
    if (pathname.startsWith(`${s.href}/`)) {
      if (best === null || s.href.length > best.href.length) best = s;
    }
  }
  return best?.slug ?? 'dashboard';
}

interface Props {
  userRole: 'admin' | 'operator';
}

/**
 * M30 — now a client component. Reads the current pathname itself via
 * `usePathname()`; the layout no longer passes `current` down. This
 * fixes the bug where client-side navigation to a sub-page (e.g.
 * `/admin/email/log`) left the wrong sidebar item highlighted because
 * the server-rendered `current` slug stayed frozen on the initial
 * render.
 */
export function AdminSidebar({ userRole }: Props): ReactElement {
  const pathname = usePathname();
  const t = useTranslations('admin.shell');
  const tg = useTranslations('admin.shell.groups');
  const tt = useTranslations('admin.shell.groupToggle');
  const visibleGroups = ADMIN_GROUPS.filter((g) => g.roles.includes(userRole));
  const current = sectionFromPath(pathname);

  // Collapse state — defaults to all-expanded on first visit (muscle
  // memory preserved). Re-hydrated from localStorage on first effect.
  // `useSyncExternalStore` would be overkill here — the user toggling
  // groups doesn't need SSR-synchronous state.
  const [collapsed, setCollapsed] = useState<Record<AdminGroupSlug, boolean>>(
    {} as Record<AdminGroupSlug, boolean>,
  );
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('ghc.admin.sidebar.collapsed');
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setCollapsed(parsed as Record<AdminGroupSlug, boolean>);
      }
    } catch {
      // localStorage may throw in private mode / sandboxed iframes —
      // collapse state just falls back to defaults. Spec §1.
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        'ghc.admin.sidebar.collapsed',
        JSON.stringify(collapsed),
      );
    } catch {
      // Same swallow as read; see above.
    }
  }, [collapsed]);

  // The active section's group is force-expanded so a click into a
  // collapsed group's child still shows the user where they are.
  function isCurrentGroupActive(g: AdminGroup): boolean {
    const section = ADMIN_SECTIONS[current];
    if (!section) return false;
    return g.slugs.includes(section.slug);
  }
  function isExpanded(g: AdminGroup): boolean {
    if (isCurrentGroupActive(g)) return true;
    return collapsed[g.slug] !== true;
  }

  return (
    <nav className="ghc-admin-sidebar" aria-label={t('sidebarAria')}>
      <ul className="ghc-admin-sidebar-list">
        {visibleGroups.map((g) => {
          const expanded = isExpanded(g);
          const groupItems = g.slugs
            .map((s) => ADMIN_SECTIONS[s])
            .filter((s) => s.roles.includes(userRole));
          // Empty groups (e.g. operator sees `access` minus `users`) still
          // render so the user knows there's nothing in this bucket.
          return (
            <li key={g.slug} className="ghc-admin-sidebar-group" data-group={g.slug}>
              <button
                type="button"
                className="ghc-admin-sidebar-group-header"
                aria-expanded={expanded}
                aria-controls={`ghc-admin-sidebar-group-${g.slug}`}
                aria-label={
                  expanded
                    ? tt('collapse', { group: tg(`${g.slug}.label`) })
                    : tt('expand', { group: tg(`${g.slug}.label`) })
                }
                onClick={() =>
                  setCollapsed((prev) => ({ ...prev, [g.slug]: expanded }))
                }
              >
                <span>{tg(`${g.slug}.label`)}</span>
                <span className="ghc-admin-sidebar-group-chevron" aria-hidden="true">
                  {expanded ? '▾' : '▸'}
                </span>
              </button>
              <ul
                id={`ghc-admin-sidebar-group-${g.slug}`}
                className="ghc-admin-sidebar-group-items"
                hidden={!expanded}
              >
                {groupItems.map((s) => {
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
                          <SidebarIcon name={s.icon} />
                        </span>
                        <span className="ghc-admin-sidebar-title">{t(`sections.${s.slug}`)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}