import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

interface Job {
  id: string;
  repositoryId: string;
  priority: number;
  scheduledFor: Date;
  attempts: number;
  repository: { owner: string; name: string };
}

/**
 * Server component — read-only table of the most-urgent pending refresh jobs.
 * Used by /admin/refresh.
 *
 * Sorted by the parent query (priority ASC, scheduledFor ASC). Top 20.
 */
export async function PendingJobsTable({ jobs }: { jobs: Job[] }): Promise<ReactElement> {
  const t = await getTranslations('admin.refresh.pendingJobs');
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold">{t('heading')}</h2>
      {jobs.length === 0 ? (
        <p className="text-sm text-gray-500">{t('empty')}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-gray-500">
            <tr>
              <th className="py-2">{t('column.jobId')}</th>
              <th className="py-2">{t('column.repository')}</th>
              <th className="py-2 text-right">{t('column.priority')}</th>
              <th className="py-2 text-right">{t('column.scheduled')}</th>
              <th className="py-2 text-right">{t('column.attempts')}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-b border-gray-100">
                <td className="py-2 font-mono text-xs">#{j.id}</td>
                <td className="py-2 font-mono text-xs">
                  {j.repository.owner}/{j.repository.name}
                </td>
                <td className="py-2 text-right">{j.priority}</td>
                <td className="py-2 text-right font-mono text-xs">
                  {j.scheduledFor.toISOString()}
                </td>
                <td className="py-2 text-right">{j.attempts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
