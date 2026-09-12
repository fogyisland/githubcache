'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactElement } from 'react';
import { SidebarIcon } from '@/app/_components/sidebar-icons';
import {
  ADMIN_SECTIONS,
  ADMIN_GROUPS,
  sectionFromPath,
  type AdminSection,
  type AdminSectionSlug,
  type AdminGroup,
  type AdminGroupSlug,
} from '@/lib/admin/sections';

export { ADMIN_SECTIONS, ADMIN_GROUPS, sectionFromPath };
export type { AdminSection, AdminSectionSlug, AdminGroup, AdminGroupSlug };

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