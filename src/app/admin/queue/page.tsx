import type { ReactElement } from 'react';
import type { RefreshJob } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { isPaused, getPausedAt } from '@/lib/scheduler';
import { getOldestPending, listJobsByStatus, listJobsInRange } from '@/lib/db/refresh-jobs';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminJobCardGrid } from '@/app/admin/_components/admin-job-card-grid';
import { QueueControls } from './_components/queue-controls';
import { QueueKpis } from './_components/queue-kpis';
import { QueueSections, type QueueJobRow } from './_components/queue-sections';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

const PER_SECTION_LIMIT = 50;
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

/**
 * Admin → Queue (M20.7).
 *
 * Read-only view of the GitHub refresh queue, with a manual "Run tick now"
 * trigger. Admin-only per spec.
 *
 * Shows the pending queue as a card grid (M30 task 4 polish — each
 * card exposes inline retry / cancel), with the in_progress / done /
 * failed sections retained as compact tables beneath. KPI cards +
 * scheduler controls render above the grid as before.
 */
export default async function AdminQueuePage(_props: object = {}): Promise<ReactElement> {
  // Auth gate — admin only (per spec).
  const { user } = await requireAdmin();

  const userTz = await resolveRequestTimezone({ dbValue: user.timezone });

  const t = await getTranslations('admin.queue');

  const now = new Date();
  const from24h = new Date(now.getTime() - WINDOW_24H_MS);

  const [pending, inProgress, done, failed, oldest, paused, pausedAt] = await Promise.all([
    listJobsByStatus('pending', PER_SECTION_LIMIT),
    listJobsByStatus('in_progress', PER_SECTION_LIMIT),
    listJobsInRange('done', from24h, now, PER_SECTION_LIMIT),
    listJobsInRange('failed', from24h, now, PER_SECTION_LIMIT),
    getOldestPending(),
    Promise.resolve(isPaused()),
    Promise.resolve(getPausedAt()),
  ]);

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.queue') },
        ]}
        title={t('title')}
        description={t('description')}
      />
      <QueueControls isPaused={paused} pausedAt={pausedAt?.toISOString() ?? null} tz={userTz} />
      <QueueKpis
        pendingCount={pending.length}
        inProgressCount={inProgress.length}
        doneCount={done.length}
        failedCount={failed.length}
        oldestPendingAt={oldest?.toISOString() ?? null}
      />
      <section>
        <h2 className="ghc-admin-section-title">
          {t('sections.pendingHeading')}{' '}
          <span className="ghc-admin-section-count">({pending.length.toLocaleString()})</span>
        </h2>
        <AdminJobCardGrid
          pending={pending.map(serializePendingJob)}
          userTz={userTz}
        />
      </section>
      <QueueSections
        inProgress={inProgress.map(serializeJob)}
        done24h={done.map(serializeJob)}
        failed24h={failed.map(serializeJob)}
        tz={userTz}
      />
    </div>
  );
}

// M31 — RefreshJob no longer joins `repository`; owner/name are read from
// the row itself.
type RefreshJobRow = RefreshJob;

function serializeJob(j: RefreshJobRow): QueueJobRow {
  return {
    id: j.id.toString(),
    repositoryId: j.repositoryId?.toString() ?? '',
    owner: j.owner,
    name: j.name,
    priority: j.priority,
    scheduledFor: j.scheduledFor.toISOString(),
    attempts: j.attempts,
    updatedAt: j.updatedAt.toISOString(),
    lastError: j.lastError,
  };
}

function serializePendingJob(j: RefreshJobRow): {
  id: bigint;
  repositoryId: bigint | null;
  status: string;
  attempts: number;
  createdAt: Date;
  lastError: string | null;
  owner: string;
  name: string;
} {
  return {
    id: j.id,
    // M31 — repositoryId may be null (queue-on-miss); pass through.
    repositoryId: j.repositoryId,
    status: j.status,
    attempts: j.attempts,
    createdAt: j.createdAt,
    lastError: j.lastError,
    owner: j.owner,
    name: j.name,
  };
}
