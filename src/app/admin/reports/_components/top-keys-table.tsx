import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { formatDateTime } from '@/lib/format/datetime';
import type { TimezoneId } from '@/lib/timezone/registry';

interface Row {
  keyId: string;
  label: string;
  requestCount: number;
  lastUsed: Date | null;
}

export async function TopKeysTable({
  rows,
  tz,
}: {
  rows: Row[];
  tz: TimezoneId;
}): Promise<ReactElement> {
  const t = await getTranslations('admin.reports.topKeys');
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
              <th className="py-2 text-right">{t('column.requests')}</th>
              <th className="py-2 text-right">{t('column.lastUsed')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k.keyId} className="border-b border-gray-100">
                <td className="py-2">
                  <a href={`/admin/api-keys/${k.keyId}`} className="text-blue-600 hover:underline">
                    {k.label}
                  </a>
                </td>
                <td className="py-2 text-right">{k.requestCount.toLocaleString()}</td>
                <td className="py-2 text-right text-gray-500">
                  {k.lastUsed ? formatDateTime(k.lastUsed, tz) : t('dash')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
