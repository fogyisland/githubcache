import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

interface Row {
  id: string;
  label: string;
  status: string;
  requestsUsed: number;
  requestsLimit: number;
  resetAt: Date | null;
}

export async function TokenQuotaTable({ rows }: { rows: Row[] }): Promise<ReactElement> {
  const t = await getTranslations('admin.reports.tokenQuota');
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">{t('heading')}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{t('empty')}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-gray-500">
            <tr>
              <th className="py-2">{t('column.label')}</th>
              <th className="py-2">{t('column.status')}</th>
              <th className="py-2 text-right">{t('column.used')}</th>
              <th className="py-2 text-right">{t('column.limit')}</th>
              <th className="py-2 text-right">{t('column.usedPct')}</th>
              <th className="py-2 text-right">{t('column.resets')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pct = row.requestsLimit === 0 ? 0 : (row.requestsUsed / row.requestsLimit) * 100;
              const variant = row.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';
              const statusKey = row.status === 'active' ? 'active' : row.status === 'disabled' ? 'disabled' : null;
              return (
                <tr key={row.id} className="border-b border-gray-100">
                  <td className="py-2">{row.label}</td>
                  <td className="py-2">
                    <span className={`rounded px-2 py-1 text-xs ${variant}`}>
                      {statusKey ? t(`status.${statusKey}` as 'status.active' | 'status.disabled') : row.status}
                    </span>
                  </td>
                  <td className="py-2 text-right">{row.requestsUsed.toLocaleString()}</td>
                  <td className="py-2 text-right">{row.requestsLimit.toLocaleString()}</td>
                  <td className="py-2 text-right">{pct.toFixed(1)}%</td>
                  <td className="py-2 text-right text-gray-500">
                    {row.resetAt ? row.resetAt.toISOString() : t('dash')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
