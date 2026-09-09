import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
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
import {
  ADMIN_SECTIONS,
  type AdminSection,
  type AdminSectionSlug,
} from '@/app/admin/_components/admin-sidebar';
import { isPaused } from '@/lib/scheduler/state';
import { getActorEmails, loadAdminStatusData } from '@/lib/admin/status-loader';
import type { AdminStatusBarData } from '@/app/admin/_components/admin-status-bar';
import type { PaletteData } from '@/app/admin/_components/command-palette';

/**
 * Map a request pathname to the matching sidebar slug. Returns
 * 'dashboard' as the fallback for any unrecognised admin path.
 *
 * M28.bug-fix — previously this looped `ADMIN_SECTIONS` in array order,
 * so sub-pages like `/admin/email/log` would match the *parent* slug
 * (`email`) first and leave "Email" highlighted on the Email log page.
 * Fix: prefer exact match immediately; among prefix matches, keep the
 * longest href (most specific section wins).
 */
function sectionForPath(pathname: string): AdminSectionSlug {
  if (pathname === '/admin' || pathname === '/admin/') return 'dashboard';
  const candidates = ADMIN_SECTIONS.filter((s) => s.slug !== 'dashboard');
  let best: AdminSection | null = null;
  for (const s of candidates) {
    if (pathname === s.href) return s.slug;
    if (pathname.startsWith(`${s.href}/`)) {
      if (best === null || s.href.length > best.href.length) best = s;
    }
  }
  return best?.slug ?? 'dashboard';
}

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
 *  - <CommandPalette> mounts once at layout root; SSR-prefetched with
 *    palette data so first paint has results.
 *  - Status-bar data is also SSR-prefetched (DB ping, queue depth,
 *    scheduler state) so the bar renders without a flash before its
 *    client poll kicks in.
 *  - Active sidebar section is derived from the pathname header set
 *    by middleware.
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

  // Pathname header set by middleware (so the server component knows the
  // active route without a client roundtrip).
  const headerStore = await headers();
  const pathname = headerStore.get('x-pathname') ?? '/admin';
  const currentSection = sectionForPath(pathname);

  // Prefetch status-bar + palette data via the helper that owns the
  // `Date.now()` calls (extracted to escape react-hooks/purity).
  const { dbPingMs, queueDepth, recentAuditCount, paletteAudit } =
    await loadAdminStatusData();

  const initialStatus: AdminStatusBarData = {
    dbPingMs,
    queueDepth,
    schedulerState: isPaused() ? 'PAUSED' : 'RUNNING',
    recentAuditCount,
    user: { email: user.email, role: user.role },
    variant: currentAdminVariant,
    fetchedAt: new Date().toISOString(),
  };

  const actorIds = [
    ...new Set(
      paletteAudit.rows
        .map((r) => r.actorUserId)
        .filter((id): id is bigint => id !== null),
    ),
  ];
  const actorEmails = await getActorEmails(actorIds);

  const paletteSections = ADMIN_SECTIONS.filter((s) => s.roles.includes(user.role)).map(
    (s) => ({ slug: s.slug, title: tShell(`sections.${s.slug}`), icon: s.icon, href: s.href }),
  );
  const paletteData: PaletteData = {
    sections: paletteSections,
    recentAudit: paletteAudit.rows.map((r) => ({
      id: r.id.toString(),
      action: r.action,
      actor: r.actorUserId ? (actorEmails.get(r.actorUserId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    })),
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
        current={currentSection}
        variant={currentAdminVariant}
        mode={currentAdminMode}
        user={{ email: user.email, role: user.role }}
        initialStatus={initialStatus}
      >
        {children}
      </AdminShell>
      <CommandPalette data={paletteData} />
    </div>
  );
}
