import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { isPaused, getPausedAt } from '@/lib/scheduler';
import {
  ingestionSummary,
  repositoryFetchBreakdown,
  recentRefreshJobs,
} from '@/lib/reports/ingestion';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { IngestionKpis } from './_components/ingestion-kpis';
import { FetchStatusBreakdown } from './_components/fetch-status-breakdown';
import { SchedulerStateCard } from './_components/scheduler-state-card';
import { RecentJobsTable } from './_components/recent-jobs-table';
import { RunViaProvider } from './_components/run-via-provider';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

/**
 * Admin → Ingestion (M16).
 *
 * Read-only view on the GitHub→DB pipeline. Shows the live queue depth
 * (current state, not bound to the window), throughput KPIs over the last
 * hour, the cached-repo fetch-status breakdown, scheduler state, and the
 * most recent N refresh jobs joined with their parent repository.
 *
 * Admin-only because it surfaces terminal failures — operators do not
 * act on these signals (they go through /admin/refresh).
 */
export default async function AdminIngestionPage({
  searchParams,
}: {
  searchParams: { limit?: string; offset?: string };
}): Promise<ReactElement> {
  const t = await getTranslations('admin.ingestion');

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

  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(searchParams.limit ?? PAGE_SIZE_DEFAULT)));
  const offset = Math.max(0, Number(searchParams.offset ?? 0));

  const now = new Date();
  const from = new Date(now.getTime() - 60 * 60 * 1000); // last 1h for done/failed KPIs

  const [summary, breakdown, jobs, paused, pausedAt] = await Promise.all([
    ingestionSummary(from, now),
    repositoryFetchBreakdown(),
    recentRefreshJobs({ skip: offset, take: limit }),
    Promise.resolve(isPaused()),
    Promise.resolve(getPausedAt()),
  ]);

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.ingestion') },
        ]}
        title={t('title')}
        description={t('description')}
      />
      <SchedulerStateCard isPaused={paused} pausedAt={pausedAt} tz={userTz} />
      <IngestionKpis
        pending={summary.pending}
        inProgress={summary.inProgress}
        done={summary.done}
        failed={summary.failed}
      />
      <FetchStatusBreakdown {...breakdown} />
      <RecentJobsTable rows={jobs} limit={limit} offset={offset} tz={userTz} />
      <RunViaProvider />
    </div>
  );
}