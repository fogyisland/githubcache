import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement, ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { LogoutButton } from '@/app/admin/logout-button';
import { AdminModeSwitcher } from '@/app/_components/admin-mode-switcher';
import { AdminClock } from '@/app/_components/admin-clock';
import {
  ADMIN_VARIANT_COOKIE,
  ADMIN_MODE_COOKIE,
} from '@/lib/admin/cookie';
import {
  isAdminVariant,
  DEFAULT_ADMIN_VARIANT,
  type AdminVariantId,
} from '@/lib/admin/variant';
import { resolveAdminMode, type AdminModeId } from '@/lib/admin/mode';
import { AdminShell } from '@/app/admin/_components/admin-shell';
import { CommandPalette } from '@/app/admin/_components/command-palette';
import { isPaused } from '@/lib/scheduler/state';
import { loadAdminStatusData } from '@/lib/admin/status-loader';
import type { AdminStatusBarData } from '@/app/admin/_components/admin-status-bar';

/**
 * Layout for all /admin/* pages.
 *
 * Auth: middleware already redirects to /login on missing session cookie,
 * but that is only a cookie-presence check. This layout performs the
 * full DB-backed `validateSession` (expiry, sliding renewal, user
 * status) and redirects on failure. No CSRF check here — CSRF only
 * applies to state-changing API routes, not to GET page renders.
 *
 * M11 wiring:
 *  - <AdminShell> wraps page children with the role-gated sidebar +
 *    variant-specific chrome + (mission_control only) status bar.
 *  - <CommandPalette> mounts once at layout root. M30: it now lazy-
 *    fetches its own data via GET /api/admin/palette on first open —
 *    the layout no longer prefetches palette data, so the layout's
 *    status-load is faster (one fewer DB round-trip on every admin
 *    page render) and palette data lives behind the same `/api/admin/*`
 *    auth boundary as everything else.
 *  - Status-bar data is SSR-prefetched (DB ping, queue depth,
 *    scheduler state) so the bar renders without a flash before its
 *    client poll kicks in. M30: wrapped in `unstable_cache` with a 60s
 *    revalidate window + an `admin-status` tag so cron-driven refreshes
 *    can invalidate the cache.
 *
 * M30 — the sidebar now derives its own active section via
 * `usePathname()`. The layout no longer reads the `x-pathname` header
 * or computes `sectionForPath()`. The middleware still sets the
 * header (other consumers may read it), but the server-rendered
 * highlight used to be frozen on first paint and broke on soft-nav.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const cookieStore = await cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const user = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });

  if (!user) {
    redirect('/login');
  }

  const currentAdminVariant: AdminVariantId = isAdminVariant(
    cookieStore.get(ADMIN_VARIANT_COOKIE)?.value,
  )
    ? (cookieStore.get(ADMIN_VARIANT_COOKIE)!.value as AdminVariantId)
    : DEFAULT_ADMIN_VARIANT;
  // M26.x — admin color mode. Read from the dedicated cookie so it stays
  // independent of the public surface's `ghc_theme` (which controls the
  // site-wide terminal/editorial/brutalist palette).
  const currentAdminMode: AdminModeId = resolveAdminMode(
    cookieStore.get(ADMIN_MODE_COOKIE)?.value,
  );

  const tShell = await getTranslations('admin.shell');

  // M30 — palette data is now fetched lazily by the CommandPalette
  // component (GET /api/admin/palette on first open). The layout no
  // longer assembles `paletteData`; the status loader no longer
  // returns `paletteAudit`. This drops the per-layout actor-lookup +
  // recent-audit query.
  const { dbPingMs, queueDepth, recentAuditCount } = await loadAdminStatusData();

  const initialStatus: AdminStatusBarData = {
    dbPingMs,
    queueDepth,
    schedulerState: isPaused() ? 'PAUSED' : 'RUNNING',
    recentAuditCount,
    user: { email: user.email, role: user.role },
    variant: currentAdminVariant,
    fetchedAt: new Date().toISOString(),
  };

  return (
    <div>
      {/* Top utility bar — slim 56px chrome.
          Left: UTC + local clock. Right: user identity pill (avatar + email + role + logout). */}
      <div className="ghc-admin-utility">
        <div className="ghc-admin-utility-left">
          <AdminClock />
        </div>
        <div className="ghc-admin-utility-right">
          <span className="ghc-admin-user-pill">
            <span className="ghc-admin-user-avatar" aria-hidden="true">
              {user.email.slice(0, 1).toUpperCase()}
            </span>
            <span className="ghc-admin-user-email">{user.email}</span>
            <span className="ghc-admin-user-role">{tShell(`role.${user.role}`)}</span>
          </span>
          <AdminModeSwitcher current={currentAdminMode} />
          <LogoutButton />
        </div>
      </div>
      <AdminShell
        variant={currentAdminVariant}
        mode={currentAdminMode}
        user={{ email: user.email, role: user.role }}
        initialStatus={initialStatus}
      >
        {children}
      </AdminShell>
      <CommandPalette />
    </div>
  );
}