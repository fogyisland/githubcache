import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import type { HeaderDoc } from '@/lib/api-docs/types';

interface HeadersTableProps {
  headers: HeaderDoc[];
  endpointNs: string;
}

export async function HeadersTable({ headers, endpointNs }: HeadersTableProps): Promise<ReactElement> {
  const t = await getTranslations('docs.headers');
  const tEp = await getTranslations(`docs.endpoint.${endpointNs}` as const);
  if (headers.length === 0) {
    return <p className="ghc-doc-empty">{t('empty')}</p>;
  }
  return (
    <table className="ghc-doc-table">
      <thead>
        <tr>
          <th>{t('columns.header')}</th>
          <th>{t('columns.description')}</th>
          <th>{t('columns.example')}</th>
        </tr>
      </thead>
      <tbody>
        {headers.map((h) => (
          <tr key={h.name}>
            <td><code>{h.name}</code></td>
            <td>
              {(() => {
                try {
                  return tEp(`headers.${h.name}-description`);
                } catch {
                  return h.description;
                }
              })()}
            </td>
            <td><code>{h.example}</code></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
