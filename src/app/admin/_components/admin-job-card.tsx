import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { AdminJobActionButton } from './admin-job-action-button';
import { formatTime } from '@/lib/format/datetime';
import type { TimezoneId } from '@/lib/timezone/registry';

interface JobRow {
  id: bigint;
  repositoryId: bigint;
  status: string;
  attempts: number;
  createdAt: Date;
  lastError: string | null;
  repository: { owner: string; name: string };
}

interface Props {
  job: JobRow;
  userTz: TimezoneId;
}

/**
 * Server component — one refresh-job card for the /admin/queue grid.
 *
 * The brief calls for cards instead of tables so each pending job can
 * show repository name, status, attempts, enqueued timestamp, and the
 * last error inline without forcing the admin to scroll a wide table
 * on a narrow viewport. The component stays a server component (the
 * page passes already-fetched data) and only the inline action buttons
 * are client islands.
 *
 * `createdAt` is the proxy for `enqueuedAt` — the model does not store
 * a separate enqueue timestamp; `scheduledFor` would have been the
 * other candidate but defaults to scheduledFor = createdAt for
 * immediate jobs and can be backdated by the scheduler.
 */
export async function AdminJobCard({ job, userTz }: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.queue.card');
  const ageMs = Date.now() - job.createdAt.getTime();
  const ageMin = Math.round(ageMs / 60000);
  const repoFullName = `${job.repository.owner}/${job.repository.name}`;
  const jobIdStr = job.id.toString();

  return (
    <article className="ghc-admin-job-card" data-status={job.status}>
      <header className="ghc-admin-job-card-head">
        <h3 className="ghc-admin-job-card-repo">
          <code className="ghc-admin-mono">{repoFullName}</code>
        </h3>
        <span className="ghc-admin-job-card-age">
          {ageMin <= 0 ? t('ageNow') : t('ageMin', { min: ageMin })}
        </span>
      </header>
      <dl className="ghc-admin-job-card-meta">
        <div>
          <dt>{t('status')}</dt>
          <dd>
            <span className={`ghc-admin-chip ghc-admin-chip-${job.status === 'pending' ? 'info' : job.status === 'in_progress' ? 'warn' : job.status === 'failed' ? 'danger' : 'ok'}`}>
              {job.status}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t('attempts')}</dt>
          <dd>{job.attempts}</dd>
        </div>
        <div>
          <dt>{t('enqueued')}</dt>
          <dd>{formatTime(job.createdAt, userTz)}</dd>
        </div>
      </dl>
      {job.lastError ? (
        <p className="ghc-admin-job-card-error">{job.lastError}</p>
      ) : null}
      <footer className="ghc-admin-job-card-actions">
        <AdminJobActionButton jobId={jobIdStr} action="retry" />
        <AdminJobActionButton jobId={jobIdStr} action="cancel" />
      </footer>
    </article>
  );
}
