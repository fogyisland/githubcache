import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { RefreshJob, Repository } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { isPaused, getPausedAt } from '@/lib/scheduler';
import { getOldestPending, listJobsByStatus, listJobsInRange } from '@/lib/db/refresh-jobs';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { QueueControls } from './_components/queue-controls';
import { QueueKpis } from './_components/queue-kpis';
import { QueueSections, type QueueJobRow } from './_components/queue-sections';

const PER_SECTION_LIMIT = 50;
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

/**
 * Admin → Queue (M20.7).
 *
 * Read-only view of the GitHub refresh queue, with a manual "Run tick now"
 * trigger. Admin-only per spec.
 *
 * Shows four status sections (pending / in_progress / done 24h / failed 24h)
 * capped at 50 each, KPI cards above them, scheduler state, and a control
 * that fires a single scheduler tick on demand. The page auto-refreshes
 * every 2s via the QueueControls client island.
 */
export default async function AdminQueuePage(): Promise<ReactElement> {
  // Auth gate — admin only (per spec).
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
  if (user.role !== 'admin') {
    redirect('/admin');
  }

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
      <QueueControls isPaused={paused} pausedAt={pausedAt?.toISOString() ?? null} />
      <QueueKpis
        pendingCount={pending.length}
        inProgressCount={inProgress.length}
        doneCount={done.length}
        failedCount={failed.length}
        oldestPendingAt={oldest?.toISOString() ?? null}
      />
      <QueueSections
        pending={pending.map(serializeJob)}
        inProgress={inProgress.map(serializeJob)}
        done24h={done.map(serializeJob)}
        failed24h={failed.map(serializeJob)}
      />
    </div>
  );
}

type RefreshJobRow = RefreshJob & { repository: Repository };

function serializeJob(j: RefreshJobRow): QueueJobRow {
  return {
    id: j.id.toString(),
    repositoryId: j.repositoryId.toString(),
    repository: { owner: j.repository.owner, name: j.repository.name },
    priority: j.priority,
    scheduledFor: j.scheduledFor.toISOString(),
    attempts: j.attempts,
    updatedAt: j.updatedAt.toISOString(),
    lastError: j.lastError,
  };
}