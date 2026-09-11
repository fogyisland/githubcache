import type { ReactElement } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { queryAuditLog, getActorEmails } from '@/lib/db/audit';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AuditFilters } from './_components/audit-filters';
import { AuditTable } from './_components/audit-table';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';
import { resolveSince } from './since-resolver';

/**
 * Admin → Audit log search (M7.5).
 *
 * Server component. Renders filter UI + paginated table.
 *
 * TODO(M7.5): `<input type="date">` produces `YYYY-MM-DD` (no time). For
 * `to`, this becomes `createdAt < 00:00 UTC`, meaning the to-date itself
 * is NOT included. Future polish: add an inclusive end-of-day option or
 * use a datetime picker.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | undefined }> }): Promise<ReactElement> {
  const sp = await searchParams;
  const t = await getTranslations('admin.audit');
  const tRange = await getTranslations('admin.audit.timeRange');

  // Admin-only gate (per spec §9.1)
  const { user } = await requireAdmin();

  const userTz = await resolveRequestTimezone({ dbValue: user.timezone });

  const limit = Math.min(200, Math.max(1, Number(sp.limit ?? 50)));
  const offset = Math.max(0, Number(sp.offset ?? 0));

  let actorUserId: bigint | undefined;
  if (sp.actorUserId) {
    try {
      actorUserId = BigInt(sp.actorUserId);
    } catch {
      /* ignore invalid — leave actorUserId undefined */
    }
  }

  // Resolve the time-range. Explicit `from` (the legacy filter input)
  // wins over `since` (the quick-range pill alias); `since` is only
  // consulted when `from` is absent. Unknown `since` tokens fall through
  // to no time filter (via resolveSince returning undefined).
  const now = new Date();
  let from: Date | undefined;
  if (sp.from) {
    const d = new Date(sp.from);
    if (!isNaN(d.getTime())) from = d;
  }
  if (!from) {
    from = resolveSince(sp.since, now);
  }

  let to: Date | undefined;
  if (sp.to) {
    const d = new Date(sp.to);
    if (!isNaN(d.getTime())) to = d;
  }

  const { rows, total } = await queryAuditLog({
    ...(sp.action ? { action: sp.action } : {}),
    ...(actorUserId !== undefined ? { actorUserId } : {}),
    ...(sp.targetType ? { targetType: sp.targetType } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    limit,
    offset,
  });

  const actorIds = [
    ...new Set(
      rows.map((r) => r.actorUserId).filter((id): id is bigint => id !== null),
    ),
  ];
  const emails = await getActorEmails(actorIds);

  const tableRows = rows.map((r) => ({
    id: r.id.toString(),
    createdAt: r.createdAt,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    actorUserId: r.actorUserId?.toString() ?? null,
    actorEmail: r.actorUserId ? (emails.get(r.actorUserId) ?? null) : null,
    ip: r.ip,
    metadata: r.metadata,
  }));

  const currentSince = sp.since ?? '';
  const sinceTokens: Array<{ token: string; label: string }> = [
    { token: '15m', label: tRange('15m') },
    { token: '1h', label: tRange('1h') },
    { token: '24h', label: tRange('24h') },
    { token: '7d', label: tRange('7d') },
    { token: '', label: tRange('all') },
  ];

  // Preserve any non-`since` query params (action / targetType / actorUserId /
  // from / to / limit / offset) when emitting each pill href. The 'All' link
  // removes only `since`, not the other filters the operator has set.
  const preservedEntries = Object.entries(sp).filter(
    ([k, v]) => k !== 'since' && v !== undefined,
  );

  function buildHref(token: string): string {
    const params = new URLSearchParams();
    if (token) params.set('since', token);
    for (const [k, v] of preservedEntries) {
      if (v !== undefined) params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/admin/audit?${qs}` : '/admin/audit';
  }

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.audit') },
        ]}
        title={t('title')}
        description={t('description')}
      />
      <nav className="ghc-admin-audit-time-range" aria-label={tRange('label')}>
        <span className="ghc-admin-audit-time-range-label">{tRange('label')}</span>
        {sinceTokens.map(({ token, label }) => {
          const href = buildHref(token);
          const active = currentSince === token;
          return (
            <Link
              key={token || 'all'}
              href={href}
              className={`ghc-admin-chip ${active ? 'ghc-admin-chip-info' : 'ghc-admin-chip-neutral'}`}
              aria-current={active ? 'page' : undefined}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <AuditFilters />
      <AuditTable
        rows={tableRows}
        total={total}
        limit={limit}
        offset={offset}
        tz={userTz}
        searchParams={sp}
      />
    </div>
  );
}
