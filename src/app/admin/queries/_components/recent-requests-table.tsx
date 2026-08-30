import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import type { RecentRequestRow } from '@/lib/reports/queries';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';

interface Props {
  rows: RecentRequestRow[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Recent RequestLog rows with a "when / endpoint / key / repo / cache /
 * latency / status" shape. Used by /admin/queries as the drill-down table.
 *
 * Pagination preserves `from`/`to` so prev/next links don't reset the date
 * window. Anonymous v1 calls render with `keyName = null` → "anonymous" in
 * the Key column (matches the new v1 recordRequest writes added in M16).
 */
export async function RecentRequestsTable({
  rows,
  total,
  limit,
  offset,
}: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.queries.recent');
  const tPag = await getTranslations('admin.common.pagination');

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">
        {t('heading')}{' '}
        <span className="text-sm font-normal text-gray-500">
          ({total.toLocaleString()})
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{t('empty')}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-gray-500">
            <tr>
              <th className="py-2">{t('column.when')}</th>
              <th className="py-2">{t('column.endpoint')}</th>
              <th className="py-2">{t('column.key')}</th>
              <th className="py-2">{t('column.repo')}</th>
              <th className="py-2 text-right">{t('column.cache')}</th>
              <th className="py-2 text-right">{t('column.latency')}</th>
              <th className="py-2 text-right">{t('column.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id.toString()} className="border-b border-gray-100">
                <td className="py-2 font-mono text-xs text-gray-600">
                  {r.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
                </td>
                <td className="py-2 font-mono text-xs">{r.endpoint}</td>
                <td className="py-2">
                  {r.keyName !== null ? (
                    <a
                      href={`/admin/api-keys/${r.keyId?.toString() ?? ''}`}
                      className="text-blue-600 hover:underline"
                    >
                      {r.keyName}
                    </a>
                  ) : (
                    <span className="text-gray-500">{t('anonymous')}</span>
                  )}
                </td>
                <td className="py-2 font-mono text-xs">
                  {r.repoRequested ?? t('dash')}
                </td>
                <td className="py-2 text-right">
                  {r.cacheHit ? t('hit') : t('miss')}
                </td>
                <td className="py-2 text-right">{r.durationMs} ms</td>
                <td className="py-2 text-right">
                  <span
                    className={
                      r.statusCode >= 400
                        ? 'font-semibold text-red-600'
                        : 'text-gray-700'
                    }
                  >
                    {r.statusCode}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AdminPagination
        basePath="/admin/queries"
        offset={offset}
        limit={limit}
        total={total}
        rowsOnPage={rows.length}
        label={tPag('showing', {
          start: total === 0 ? 0 : offset + 1,
          end: offset + rows.length,
          total,
        })}
      />
    </div>
  );
}