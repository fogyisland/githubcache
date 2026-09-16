import type { SidebarIconName } from '@/app/_components/sidebar-icons';

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
  | 'email-log'
  | 'import';

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
 *
 * M30.9 — moved out of `admin-sidebar.tsx` into this server-safe module.
 * The previous location had `'use client'` at the top (for `usePathname()`),
 * and RSC's `registerClientReference` wrapping caused server-side
 * `Object.values(ADMIN_SECTIONS)` to resolve to `{}` — breaking
 * `/api/admin/palette`. See ledger F1.
 */
export const ADMIN_SECTIONS: Record<AdminSectionSlug, AdminSection> = {
  dashboard:       { slug: 'dashboard',       icon: 'dashboard',       href: '/admin',              roles: ['admin', 'operator'] },
  users:           { slug: 'users',           icon: 'users',           href: '/admin/users',        roles: ['admin'] },
  'api-keys':      { slug: 'api-keys',        icon: 'api-keys',        href: '/admin/api-keys',     roles: ['admin', 'operator'] },
  'github-tokens': { slug: 'github-tokens',   icon: 'github-tokens',   href: '/admin/github-tokens',roles: ['admin', 'operator'] },
  reports:         { slug: 'reports',         icon: 'reports',         href: '/admin/reports',      roles: ['admin', 'operator'] },
  queries:         { slug: 'queries',         icon: 'queries',         href: '/admin/queries',      roles: ['admin', 'operator'] },
  ingestion:       { slug: 'ingestion',       icon: 'ingestion',       href: '/admin/ingestion',    roles: ['admin'] },
  providers:       { slug: 'providers',       icon: 'providers',       href: '/admin/providers',    roles: ['admin'] },
  repositories:    { slug: 'repositories',    icon: 'repositories',    href: '/admin/repositories', roles: ['admin', 'operator'] },
  audit:           { slug: 'audit',           icon: 'audit',           href: '/admin/audit',        roles: ['admin'] },
  refresh:         { slug: 'refresh',         icon: 'refresh',         href: '/admin/refresh',      roles: ['admin'] },
  queue:           { slug: 'queue',           icon: 'queue',           href: '/admin/queue',        roles: ['admin'] },
  webhooks:        { slug: 'webhooks',        icon: 'webhooks',        href: '/admin/webhooks',     roles: ['admin'] },
  database:        { slug: 'database',        icon: 'database',        href: '/admin/database',     roles: ['admin'] },
  'api-settings':  { slug: 'api-settings',    icon: 'queries',         href: '/admin/api-settings', roles: ['admin'] },
  insights:        { slug: 'insights',        icon: 'insights',        href: '/admin/insights',     roles: ['admin'] },
  // M25 — SMTP config + send log. Admin only because misconfiguration
  // can leak credentials to attackers who phish the form.
  email:           { slug: 'email',           icon: 'email',           href: '/admin/email',        roles: ['admin'] },
  'email-log':     { slug: 'email-log',       icon: 'email-log',       href: '/admin/email/log',    roles: ['admin'] },
  // M32.7.7-b — Cross-database data import (admin-only because it can
  // write to /admin/* tables from an external source DB).
  import:          { slug: 'import',          icon: 'import',          href: '/admin/import',       roles: ['admin'] },
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
  { slug: 'operations', slugs: ['refresh', 'queue', 'webhooks', 'audit', 'import'],    roles: ['admin'] },
  { slug: 'system',     slugs: ['database', 'api-settings', 'insights', 'email', 'email-log', 'reports', 'queries'], roles: ['admin'] },
];

/**
 * Pick the active sidebar slug from the current pathname. Returns
 * 'dashboard' as the fallback for any unrecognised admin path.
 *
 * M30 — moved out of `layout.tsx` (where it ran server-side and broke
 * on client-side navigation: the server-rendered highlight was right
 * for the initial page, but soft-nav to a sub-page didn't update
 * anything because the server never re-rendered).
 *
 * M28.bug-fix: prefer exact match immediately; among prefix matches,
 * keep the longest href (most specific section wins). Sub-pages like
 * `/admin/email/log` therefore match `email-log` (not `email`, not `dashboard`).
 *
 * M30.9 — moved to this server-safe module; used by `admin-sidebar.tsx`
 * (client) and could be used server-side too if needed.
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
