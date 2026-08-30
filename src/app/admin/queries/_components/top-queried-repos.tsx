import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import type { TopRepo } from '@/lib/reports/queries';

/**
 * Compact top-repos table for the /admin/queries page. Reuses the same
 * `TopRepo` shape produced by `topRepos()` so callers don't need a new
 * aggregation. Strings live under `admin.queries.topRepos` to keep
 * page-local copy decoupled from /admin/reports.
 */
export async function TopQueriedReposTable({
  rows,
}: {
  rows: TopRepo[];
}): Promise<ReactElement> {
  const t = await getTranslations('admin.queries.topRepos');
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">{t('heading')}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{t('empty')}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-gray-500">
            <tr>
              <th className="py-2">{t('column.repo')}</th>
              <th className="py-2 text-right">{t('column.requests')}</th>
              <th className="py-2 text-right">{t('column.hitRate')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.repo} className="border-b border-gray-100">
                <td className="py-2 font-mono text-xs">{r.repo}</td>
                <td className="py-2 text-right">{r.requestCount.toLocaleString()}</td>
                <td className="py-2 text-right">{(r.hitRate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}