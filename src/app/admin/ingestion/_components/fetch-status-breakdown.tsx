import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import type { FetchStatusBreakdown } from '@/lib/reports/ingestion';

interface Props extends FetchStatusBreakdown {}

/**
 * One-row distribution bar for the four terminal `Repository.fetch_status`
 * values. Each segment is sized by its share of the total cache; `error`
 * and `forbidden` segments use a stronger accent so a glance reveals
 * trouble even when the bars are long.
 */
export async function FetchStatusBreakdown({
  ok,
  not_found,
  forbidden,
  error,
}: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.ingestion.breakdown');
  const segments = [
    { key: 'ok', label: t('ok'), count: ok, className: 'bg-emerald-500' },
    { key: 'not_found', label: t('notFound'), count: not_found, className: 'bg-amber-500' },
    { key: 'forbidden', label: t('forbidden'), count: forbidden, className: 'bg-rose-500' },
    { key: 'error', label: t('error'), count: error, className: 'bg-red-600' },
  ] as const;
  const total = ok + not_found + forbidden + error;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">{t('heading')}</h2>
      {total === 0 ? (
        <p className="text-sm text-gray-500">{t('empty')}</p>
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded bg-gray-100">
            {segments.map((s) =>
              s.count > 0 ? (
                <div
                  key={s.key}
                  className={s.className}
                  style={{ width: `${(s.count / total) * 100}%` }}
                  title={`${s.label}: ${s.count}`}
                />
              ) : null,
            )}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {segments.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span
                  className={'inline-block h-3 w-3 rounded ' + s.className}
                  aria-hidden="true"
                />
                <span className="text-gray-600">{s.label}</span>
                <span className="ml-auto font-mono text-xs text-gray-900">
                  {s.count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}