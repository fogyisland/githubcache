import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { listPendingJobs, listRepositoriesForPicker } from '@/lib/db/refresh-jobs';
import { isPaused, getPausedAt } from '@/lib/scheduler';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { RefreshControls } from './_components/refresh-controls';
import { QuickRefreshForm } from './_components/quick-refresh-form';
import { PendingJobsTable } from './_components/pending-jobs-table';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

/**
 * Admin → Manual refresh + queue pause (M7.6, M30 task 4).
 *
 * Admin-only per spec §9.1.
 *
 * Shows:
 *   - Inline "owner/name" quick-refresh form (M30 task 4)
 *   - Scheduler state (RUNNING/PAUSED + pausedAt timestamp)
 *   - Manual refresh trigger form (repo picker + button)
 *   - Pending refresh jobs (top 20)
 *
 * Pause is process-local (single-worker design per M5.5). The
 * `RefreshControls` client component surfaces this caveat inline.
 */
export default async function AdminRefreshPage(): Promise<ReactElement> {
  const t = await getTranslations('admin.refresh');

  // Auth gate — admin only (per spec §9.1)
  const { user } = await requireAdmin();

  const userTz = await resolveRequestTimezone({ dbValue: user.timezone });

  const [pendingJobs, repos] = await Promise.all([
    listPendingJobs(20),
    listRepositoriesForPicker(100),
  ]);

  const paused = isPaused();
  const pausedAt = getPausedAt();

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.refresh') },
        ]}
        title={t('title')}
        description={t('description')}
      />
      <QuickRefreshForm />
      <RefreshControls
        isPaused={paused}
        pausedAt={pausedAt?.toISOString() ?? null}
        tz={userTz}
        repos={repos.map((r) => ({ ...r, id: r.id.toString() }))}
      />
      <PendingJobsTable
        jobs={pendingJobs.map((j) => ({
          ...j,
          id: j.id.toString(),
          repositoryId: j.repositoryId.toString(),
          repository: { owner: j.repository.owner, name: j.repository.name },
        }))}
      />
    </div>
  );
}
