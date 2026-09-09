import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { FetchStatus, RefreshJobStatus } from '@prisma/client';
import { findRepoByCanonical } from '@/lib/db/repositories';
import { prisma } from '@/lib/db/client';
import { getActorEmails } from '@/lib/db/audit';
import { validateSession } from '@/lib/auth/session';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip, type AdminChipVariant } from '@/app/admin/_components/admin-status-chip';
import { formatDateTime } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

interface PageProps {
  params: Promise<{ owner: string; name: string }>;
}

interface RefreshRow {
 id: bigint;
 scheduledFor: Date;
 updatedAt: Date;
 status: RefreshJobStatus;
 priority: number;
 attempts: number;
 lastError: string | null;
}

interface AuditRow {
 id: bigint;
 createdAt: Date;
 action: string;
 actorUserId: bigint | null;
 ip: string | null;
 metadata: unknown;
}

const FETCH_STATUS_VARIANT: Record<FetchStatus, AdminChipVariant> = {
 ok: 'ok',
 not_found: 'warn',
 forbidden: 'warn',
 error: 'danger',
};

const REFRESH_STATUS_VARIANT: Record<RefreshJobStatus, AdminChipVariant> = {
 done: 'ok',
 failed: 'danger',
 pending: 'neutral',
 in_progress: 'warn',
};

const REFRESH_PAGE_SIZE = 25;
const AUDIT_PAGE_SIZE = 25;

/**
 * Server action stub for the manual re-fetch button. Wired through a
 * `<form>` so the markup can be progressively enhanced; the real API
 * endpoint (POST /api/admin/repositories/{owner}/{name}/refresh) is a
 * follow-up. For now we just revalidate the page so the user sees the
 * current state.
 */
async function enqueueRefreshAction(): Promise<void> {
 'use server';
 // Intentionally a no-op for the UI scaffold — the real endpoint
 // enqueueing a refresh_job is a separate follow-up. We revalidate the
 // current path so any pending state shows up.
 const { revalidatePath } = await import('next/cache');
 revalidatePath('/admin/repositories');
}

/**
 * Admin → Repository detail (M24 task 295).
 *
 * Operator-facing page reached by clicking a row in /admin/repositories.
 * Shows the cached row, recent refresh_jobs for this repo, and recent
 * audit_log entries targeted at this repo. A manual re-fetch button
 * posts to a stub server action (the API endpoint is a follow-up).
 *
 * Audit filter: includes both forms written by the existing code base —
 * - scheduler writes `targetId = owner/name` (refresh-one.ts)
 * - manual trigger writes `targetId = String(repoId)` (refresh/route.ts)
 * so we match either. See M24 deviation note.
 */
export default async function AdminRepositoryDetailPage({
  params,
}: PageProps): Promise<ReactElement> {
 const p = await params;
 const owner = decodeURIComponent(p.owner);
 const name = decodeURIComponent(p.name);

 // Layout already validated the session; we don't gate again here.
 const cookieStore = await cookies();
 const cookieMap = Object.fromEntries(
 cookieStore.getAll().map((c) => [c.name, c.value]),
 );
 const session = await validateSession({
 headers: new Headers(),
 cookies: {
 get: (key: string) =>
 cookieMap[key] !== undefined ? { value: cookieMap[key]! } : undefined,
 },
 });
 const userTz = await resolveRequestTimezone({ dbValue: session?.timezone ?? null });

 const repo = await findRepoByCanonical(owner, name);
 if (!repo) notFound();

 const repoIdString = repo.id.toString();
 const canonicalId = `${owner}/${name}`;

 const [refreshJobs, auditRows] = await Promise.all([
 prisma.refreshJob.findMany({
 where: { repositoryId: repo.id },
 orderBy: { updatedAt: 'desc' },
 take: REFRESH_PAGE_SIZE,
 }),
 // Match either form of targetId that existing writers emit — see the
 // file-level comment for context.
 prisma.auditLog.findMany({
 where: {
 targetType: 'repository',
 targetId: { in: [repoIdString, canonicalId] },
 },
 orderBy: { createdAt: 'desc' },
 take: AUDIT_PAGE_SIZE,
 }),
 ]);

 const t = await getTranslations('admin.repositories.detail');

 const actorIds = [
 ...new Set(
 auditRows
 .map((r) => r.actorUserId)
 .filter((id): id is bigint => id !== null),
 ),
 ];
 const actorEmails = await getActorEmails(actorIds);

 const refreshColumns: AdminColumn<RefreshRow>[] = [
 {
 key: 'when',
 header: t('column.when'),
 render: (r) => formatDateTime(r.scheduledFor, userTz),
 },
 {
 key: 'status',
 header: t('column.status'),
 render: (r) => (
 <AdminStatusChip variant={REFRESH_STATUS_VARIANT[r.status]}>
 {r.status}
 </AdminStatusChip>
 ),
 },
 {
 key: 'priority',
 header: t('column.priority'),
 align: 'right',
 render: (r) => r.priority,
 },
 {
 key: 'attempts',
 header: t('column.attempts'),
 align: 'right',
 render: (r) => r.attempts,
 },
 {
 key: 'error',
 header: t('column.error'),
 render: (r) =>
 r.lastError ? (
 <span
 className="ghc-admin-error-cell"
 title={r.lastError}
 >
 {r.lastError.length > 80 ? `${r.lastError.slice(0, 80)}…` : r.lastError}
 </span>
 ) : (
 <span className="ghc-admin-muted">—</span>
 ),
 },
 ];

 const auditColumns: AdminColumn<AuditRow>[] = [
 {
 key: 'when',
 header: t('column.when'),
 render: (r) => formatDateTime(r.createdAt, userTz),
 },
 {
 key: 'action',
 header: t('column.action'),
 render: (r) => (
 <AdminStatusChip variant="neutral">{r.action}</AdminStatusChip>
 ),
 },
 {
 key: 'actor',
 header: t('column.actor'),
 render: (r) =>
 r.actorUserId
 ? (actorEmails.get(r.actorUserId) ?? `#${r.actorUserId.toString()}`)
 : '—',
 },
 {
 key: 'ip',
 header: t('column.ip'),
 render: (r) => r.ip ?? '—',
 },
 {
 key: 'metadata',
 header: 'metadata',
 render: (r) => (
 <code className="ghc-admin-mono">
 {JSON.stringify(r.metadata)}
 </code>
 ),
 },
 ];

 return (
 <div className="ghc-admin-page">
 <AdminPageHeader
 breadcrumb={[
 { label: t('breadcrumbAdmin'), href: '/admin' },
 { label: t('breadcrumbRepositories'), href: '/admin/repositories' },
 { label: canonicalId },
 ]}
 title={t('title', { owner, name })}
 />

 <section className="ghc-admin-detail-card">
 <h2 className="ghc-admin-section-title">{t('statusHeading')}</h2>
 <dl className="ghc-admin-detail-dl">
 <div className="ghc-admin-detail-row">
 <dt>owner</dt>
 <dd>
 <code className="ghc-admin-mono">{repo.owner}</code>
 </dd>
 </div>
 <div className="ghc-admin-detail-row">
 <dt>name</dt>
 <dd>
 <code className="ghc-admin-mono">{repo.name}</code>
 </dd>
 </div>
 <div className="ghc-admin-detail-row">
 <dt>{t('statusHeading')}</dt>
 <dd>
 <AdminStatusChip variant={FETCH_STATUS_VARIANT[repo.fetchStatus]}>
 {repo.fetchStatus}
 </AdminStatusChip>
 </dd>
 </div>
 <div className="ghc-admin-detail-row">
 <dt>{t('lastFetched')}</dt>
 <dd>
 {repo.lastFetchedAt
 ? formatDateTime(repo.lastFetchedAt, userTz)
 : '—'}
 </dd>
 </div>
 <div className="ghc-admin-detail-row">
 <dt>{t('createdAt')}</dt>
 <dd>{formatDateTime(repo.createdAt, userTz)}</dd>
 </div>
 </dl>

 {/* Collapsible node JSON preview — mirrors the public /repo/.../api-shape.tsx
 aesthetic so operators recognise the same dump they saw there. */}
 <div className="ghc-api-shape mt-4" data-testid="ghc-admin-repo-node">
 <details className="ghc-api-shape-details">
 <summary className="ghc-api-shape-summary">
 <span className="ghc-section-eyebrow">node</span>
 <span className="ghc-api-shape-hint">{canonicalId}</span>
 </summary>
 <pre className="ghc-code-block ghc-api-shape-pre">
 <code>{JSON.stringify(repo.node, null, 2)}</code>
 </pre>
 </details>
 </div>

 <form action={enqueueRefreshAction} className="mt-4">
 <button type="submit" className="ghc-btn-primary">
 {t('refreshNow')}
 </button>
 </form>
 </section>

 <section>
 <h2 className="ghc-admin-section-title">
 {t('refreshHeading')}{' '}
 <span className="ghc-admin-section-count">
 ({refreshJobs.length})
 </span>
 </h2>
 <AdminTable<RefreshRow>
 columns={refreshColumns}
 rows={refreshJobs}
 emptyTitle={t('refreshEmpty')}
 ariaLabel={t('refreshHeading')}
 />
 </section>

 <section>
 <h2 className="ghc-admin-section-title">
 {t('auditHeading')}{' '}
 <span className="ghc-admin-section-count">({auditRows.length})</span>
 </h2>
 <AdminTable<AuditRow>
 columns={auditColumns}
 rows={auditRows}
 emptyTitle={t('auditEmpty')}
 ariaLabel={t('auditHeading')}
 />
 </section>
 </div>
 );
}
