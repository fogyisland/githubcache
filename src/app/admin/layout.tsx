import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import type { ReactElement, ReactNode } from 'react';
import { validateSession } from '@/lib/auth/session';
import { LogoutButton } from '@/app/admin/logout-button';
import { ThemeSwitcher } from '@/app/_components/theme-switcher';
import { AdminVariantSwitcher } from '@/app/_components/admin-variant-switcher';
import {
  DEFAULT_THEME,
  isThemeId,
  type ThemeId,
} from '@/lib/theme/themes';
import { THEME_COOKIE } from '@/lib/theme/cookie';
import {
  ADMIN_VARIANT_COOKIE,
} from '@/lib/admin/cookie';
import {
  isAdminVariant,
  DEFAULT_ADMIN_VARIANT,
  type AdminVariantId,
} from '@/lib/admin/variant';
import { AdminShell } from '@/app/admin/_components/admin-shell';
import { CommandPalette } from '@/app/admin/_components/command-palette';
import {
  ADMIN_SECTIONS,
  type AdminSectionSlug,
} from '@/app/admin/_components/admin-sidebar';
import { prisma } from '@/lib/db/client';
import { isPaused } from '@/lib/scheduler/state';
import { queryAuditLog, getActorEmails } from '@/lib/db/audit';
import type { AdminStatusBarData } from '@/app/admin/_components/admin-status-bar';
import type { PaletteData } from '@/app/admin/_components/command-palette';

/**
 * Map a request pathname to the matching sidebar slug. Returns
 * 'dashboard' as the fallback for any unrecognised admin path.
 */
function sectionForPath(pathname: string): AdminSectionSlug {
  if (pathname === '/admin' || pathname === '/admin/') return 'dashboard';
  // Order matters — more specific slugs first.
  const matches = ADMIN_SECTIONS.filter((s) => s.slug !== 'dashboard');
  for (const s of matches) {
    if (pathname === s.href || pathname.startsWith(`${s.href}/`)) return s.slug;
  }
  return 'dashboard';
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
  const cookieStore = cookies();
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

  const currentTheme: ThemeId = isThemeId(cookieStore.get(THEME_COOKIE)?.value)
    ? (cookieStore.get(THEME_COOKIE)!.value as ThemeId)
    : DEFAULT_THEME;
  const currentAdminVariant: AdminVariantId = isAdminVariant(
    cookieStore.get(ADMIN_VARIANT_COOKIE)?.value,
  )
    ? (cookieStore.get(ADMIN_VARIANT_COOKIE)!.value as AdminVariantId)
    : DEFAULT_ADMIN_VARIANT;

  // Pathname header set by middleware (so the server component knows the
  // active route without a client roundtrip).
  const headerStore = headers();
  const pathname = headerStore.get('x-pathname') ?? '/admin';
  const currentSection = sectionForPath(pathname);

  // Prefetch status-bar + palette data in parallel.
  const [pingStart, paletteAudit] = await Promise.all([
    Promise.resolve(Date.now()).then((t) => ({ start: t })),
    queryAuditLog({ limit: 5, offset: 0 }),
  ]);
  await prisma.$queryRaw`SELECT 1`;
  const dbPingMs = Date.now() - pingStart.start;

  const [queueDepth, recentAuditCount] = await Promise.all([
    prisma.refreshJob.count({ where: { status: 'pending' } }),
    prisma.auditLog.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);

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
    (s) => ({ slug: s.slug, title: s.title, icon: s.icon, href: s.href }),
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
      {/* Top utility bar (theme switcher + variant switcher + logout) — kept
          outside AdminShell so it stays on top across all variants. */}
      <div className="ghc-admin-utility">
        <span className="text-sm">
          {user.email} ({user.role})
        </span>
        <AdminVariantSwitcher current={currentAdminVariant} />
        <ThemeSwitcher current={currentTheme} />
        <LogoutButton />
      </div>
      <AdminShell
        current={currentSection}
        variant={currentAdminVariant}
        user={{ email: user.email, role: user.role }}
        initialStatus={initialStatus}
      >
        {children}
      </AdminShell>
      <CommandPalette data={paletteData} />
    </div>
  );
}