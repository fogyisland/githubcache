import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

interface Props {
  pending: number;
  inProgress: number;
  done: number;
  failed: number;
}

/**
 * Four-card pipeline KPI strip for /admin/ingestion. The pending/in-progress
 * counts reflect current queue state (NOT bound to the time window), so an
 * empty `done`/`failed` window still tells the admin whether the scheduler
 * has anything left to chew on.
 */
export async function IngestionKpis({
  pending,
  inProgress,
  done,
  failed,
}: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.ingestion.kpi');
  const cards = [
    { label: t('pending'), value: pending.toLocaleString() },
    { label: t('inProgress'), value: inProgress.toLocaleString() },
    { label: t('done'), value: done.toLocaleString() },
    { label: t('failed'), value: failed.toLocaleString(), warn: failed > 0 },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
        >
          <div className="text-sm text-gray-500">{c.label}</div>
          <div
            className={
              'mt-2 text-2xl font-semibold ' +
              (c.warn ? 'text-red-600' : 'text-gray-900')
            }
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}