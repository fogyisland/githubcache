import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import type { ErrorDoc } from '@/lib/api-docs/types';

interface ErrorsTableProps {
  errors: ErrorDoc[];
  endpointNs: string;
}

export async function ErrorsTable({ errors, endpointNs }: ErrorsTableProps): Promise<ReactElement> {
  const t = await getTranslations('docs.errors');
  const tEp = await getTranslations(`docs.endpoint.${endpointNs}` as const);
  if (errors.length === 0) {
    return <p className="ghc-doc-empty">{t('empty')}</p>;
  }
  return (
    <table className="ghc-doc-table">
      <thead>
        <tr>
          <th>{t('columns.status')}</th>
          <th>{t('columns.error')}</th>
          <th>{t('columns.when')}</th>
        </tr>
      </thead>
      <tbody>
        {errors.map((e) => {
          const key = `${e.status}-${e.error.replace(/\s+/g, '_')}`;
          return (
            <tr key={key}>
              <td><code>{e.status}</code></td>
              <td><code>{e.error}</code></td>
              <td>
                {(() => {
                  try {
                    return tEp(`errors.${key}`);
                  } catch {
                    return e.when;
                  }
                })()}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
