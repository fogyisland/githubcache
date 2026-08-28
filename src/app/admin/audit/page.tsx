import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { queryAuditLog, getActorEmails } from '@/lib/db/audit';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AuditFilters } from './_components/audit-filters';
import { AuditTable } from './_components/audit-table';

/**
 * Admin → Audit log search (M7.5).
 *
 * Server component. Renders filter UI + paginated table.
 *
 * TODO(M7.5): Prev/next pagination currently preserves only `offset`+`limit`
 * — filters reset on pagination. Future polish: preserve all filters in
 * prev/next href builders (audit-table.tsx).
 *
 * TODO(M7.5): `<input type="date">` produces `YYYY-MM-DD` (no time). For
 * `to`, this becomes `createdAt < 00:00 UTC`, meaning the to-date itself
 * is NOT included. Future polish: add an inclusive end-of-day option or
 * use a datetime picker.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: { [k: string]: string | undefined };
}): Promise<ReactElement> {
  const t = await getTranslations('admin.audit');

  // Admin-only gate (per spec §9.1)
  const cookieStore = cookies();
  const cookieMap = Object.fromEntries(
    cookieStore.getAll().map((c) => [c.name, c.value]),
  );
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
  if (user.role !== 'admin') {
    redirect('/admin');
  }

  const limit = Math.min(200, Math.max(1, Number(searchParams.limit ?? 50)));
  const offset = Math.max(0, Number(searchParams.offset ?? 0));

  let actorUserId: bigint | undefined;
  if (searchParams.actorUserId) {
    try {
      actorUserId = BigInt(searchParams.actorUserId);
    } catch {
      /* ignore invalid — leave actorUserId undefined */
    }
  }

  let from: Date | undefined;
  if (searchParams.from) {
    const d = new Date(searchParams.from);
    if (!isNaN(d.getTime())) from = d;
  }

  let to: Date | undefined;
  if (searchParams.to) {
    const d = new Date(searchParams.to);
    if (!isNaN(d.getTime())) to = d;
  }

  const { rows, total } = await queryAuditLog({
    ...(searchParams.action ? { action: searchParams.action } : {}),
    ...(actorUserId !== undefined ? { actorUserId } : {}),
    ...(searchParams.targetType ? { targetType: searchParams.targetType } : {}),
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
      <AuditFilters />
      <AuditTable rows={tableRows} total={total} limit={limit} offset={offset} />
    </div>
  );
}
