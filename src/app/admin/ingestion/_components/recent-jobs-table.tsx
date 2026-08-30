import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import type { RecentRefreshJobRow } from '@/lib/reports/ingestion';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';

interface Props {
  rows: Array<RecentRefreshJobRow & { total: number }>;
  limit: number;
  offset: number;
}

const STATUS_VARIANT: Record<
  RecentRefreshJobRow['status'],
  'ok' | 'warn' | 'danger' | 'neutral'
> = {
  done: 'ok',
  pending: 'neutral',
  in_progress: 'warn',
  failed: 'danger',
};

/**
 * Recent RefreshJob rows joined with their parent repository. The
 * "Repo" column shows `owner/name` as a code block (not linked — there is
 * no repo detail admin page yet). `lastError` truncates at 80 chars so
 * a single bad row doesn't blow out the row height.
 */
export async function RecentJobsTable({
  rows,
  limit,
  offset,
}: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.ingestion.recent');
  const tPag = await getTranslations('admin.common.pagination');
  const total = rows[0]?.total ?? 0;
  const truncate = (s: string | null, n: number): string =>
    s === null ? t('dash') : s.length > n ? `${s.slice(0, n)}…` : s;

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
              <th className="py-2">{t('column.repo')}</th>
              <th className="py-2">{t('column.status')}</th>
              <th className="py-2 text-right">{t('column.priority')}</th>
              <th className="py-2 text-right">{t('column.attempts')}</th>
              <th className="py-2">{t('column.error')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id.toString()} className="border-b border-gray-100">
                <td className="py-2 font-mono text-xs text-gray-600">
                  {r.updatedAt.toISOString().replace('T', ' ').slice(0, 19)}
                </td>
                <td className="py-2 font-mono text-xs">
                  {r.repositoryOwner}/{r.repositoryName}
                </td>
                <td className="py-2">
                  <AdminStatusChip variant={STATUS_VARIANT[r.status]}>
                    {t(`status.${r.status}`)}
                  </AdminStatusChip>
                </td>
                <td className="py-2 text-right font-mono text-xs">
                  {r.priority}
                </td>
                <td className="py-2 text-right">{r.attempts}</td>
                <td className="py-2 font-mono text-xs text-gray-600">
                  {truncate(r.lastError, 80)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AdminPagination
        basePath="/admin/ingestion"
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