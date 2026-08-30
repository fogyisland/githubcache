import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

/**
 * Compact top-keys table for the /admin/queries page. Mirrors the
 * /admin/reports counterpart but with `admin.queries.topKeys` strings and a
 * clickable label that drills into the API-key detail page.
 */
export async function TopKeysTable({
  rows,
}: {
  rows: Array<{
    keyId: string;
    label: string;
    requestCount: number;
    lastUsed: Date | null;
  }>;
}): Promise<ReactElement> {
  const t = await getTranslations('admin.queries.topKeys');
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
                  <a
                    href={`/admin/api-keys/${k.keyId}`}
                    className="text-blue-600 hover:underline"
                  >
                    {k.label}
                  </a>
                </td>
                <td className="py-2 text-right">{k.requestCount.toLocaleString()}</td>
                <td className="py-2 text-right text-gray-500">
                  {k.lastUsed ? k.lastUsed.toISOString() : t('dash')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}