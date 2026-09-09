import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { listPendingJobs, listRepositoriesForPicker } from '@/lib/db/refresh-jobs';
import { isPaused, getPausedAt } from '@/lib/scheduler';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { RefreshControls } from './_components/refresh-controls';
import { PendingJobsTable } from './_components/pending-jobs-table';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

/**
 * Admin → Manual refresh + queue pause (M7.6).
 *
 * Admin-only per spec §9.1.
 *
 * Shows:
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
  if (user.role !== 'admin') {
    redirect('/admin');
  }

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
