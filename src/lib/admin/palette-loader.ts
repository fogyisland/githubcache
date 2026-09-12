import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db/client';
import { queryAuditLog, getActorEmails } from '@/lib/db/audit';
import { ADMIN_SECTIONS } from '@/app/admin/_components/admin-sidebar';
import type {
  PaletteData,
  PaletteSection,
  PaletteAuditEntry,
  IndexedPaletteItem,
} from '@/app/admin/_components/command-palette';

/**
 * M30 — Task 2. Build the command-palette payload on demand.
 *
 * Replaces the M11.5 inline assembly that previously lived in
 * `src/app/api/admin/palette/route.ts` and which the admin layout
 * used to prefetch on every render. Now:
 *
 *  - `loadPaletteData(role)` is called by the API route only — the
 *    layout no longer touches palette data at all (frees the layout
 *    from a 5-row `auditLog.findMany` + actor-email `findMany` on
 *    every admin page render).
 *  - `sections` is filtered by the caller's role — operators only
 *    see operator-visible slugs (matches the sidebar's own filter).
 *  - `indexed` seeds the palette with the 20 most-recently-active
 *    users so "go to user 42" / "go to alice" actually resolve. The
 *    label format `User #<id> — <email>` is what `matchPaletteQuery`
 *    substring-matches against; "#" is normalized out at query time
 *    so "user 42" still matches.
 *
 * Returns a fully-formed `PaletteData` — typed against the
 * command-palette component's exported types so the route can
 * `NextResponse.json(data)` it directly.
 */
export async function loadPaletteData(
  userRole: 'admin' | 'operator',
): Promise<PaletteData> {
  const t = await getTranslations('admin.shell');

  const visible = Object.values(ADMIN_SECTIONS).filter((s) => s.roles.includes(userRole));
  const sections: PaletteSection[] = visible.map((s) => ({
    slug: s.slug,
    title: t(`sections.${s.slug}`),
    icon: s.icon,
    href: s.href,
  }));

  // Most-recent 5 audit entries — same window the M11.5 stub used.
  const auditPage = await queryAuditLog({ limit: 5, offset: 0 });
  const actorIds = [
    ...new Set(
      auditPage.rows
        .map((r) => r.actorUserId)
        .filter((id): id is bigint => id !== null),
    ),
  ];
  const actorEmails = await getActorEmails(actorIds);
  const recentAudit: PaletteAuditEntry[] = auditPage.rows.map((r) => ({
    id: r.id.toString(),
    action: r.action,
    actor: r.actorUserId ? (actorEmails.get(r.actorUserId) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  }));

  // Build indexed detail hits — pull the 20 most recently active users
  // so "go to user 42" / "go to alice" actually resolves. Ordered by
  // lastLoginAt desc, then id desc, so the freshest sessions surface
  // first (matches the "what did I just work on" mental model).
  const recentUsers = await prisma.user.findMany({
    orderBy: [{ lastLoginAt: 'desc' }, { id: 'desc' }],
    take: 20,
    select: { id: true, email: true },
  });
  const indexed: IndexedPaletteItem[] = recentUsers.map((u) => ({
    kind: 'detail' as const,
    label: `User #${u.id.toString()} — ${u.email}`,
    href: `/admin/users/${u.id.toString()}`,
  }));

  return { sections, recentAudit, indexed };
}
