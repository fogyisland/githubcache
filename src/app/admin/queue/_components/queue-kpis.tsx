import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

interface Props {
  pendingCount: number;
  inProgressCount: number;
  doneCount: number;
  failedCount: number;
  oldestPendingAt: string | null;
}

/**
 * Five-card KPI strip for /admin/queue (M20.7).
 *
 *   pending / in_progress / done 24h / failed 24h — raw counts
 *   oldest pending — relative age of the queue head (server-side formatted
 *     via the admin.queue.kpi.oldestPending.* keys). Dash when queue empty.
 */
export async function QueueKpis({
  pendingCount,
  inProgressCount,
  doneCount,
  failedCount,
  oldestPendingAt,
}: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.queue.kpi');
  const oldest = formatOldest(oldestPendingAt, t);

  const cards = [
    { label: t('pending'), value: pendingCount.toLocaleString() },
    { label: t('inProgress'), value: inProgressCount.toLocaleString() },
    { label: t('done24h'), value: doneCount.toLocaleString() },
    {
      label: t('failed24h'),
      value: failedCount.toLocaleString(),
      warn: failedCount > 0,
    },
    { label: t('oldestPending'), value: oldest },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
        >
          <div className="text-sm text-gray-500">{c.label}</div>
          <div
            className={
              'mt-2 text-2xl font-semibold ' +
              (c.warn === true ? 'text-red-600' : 'text-gray-900')
            }
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

type Translator = (key: string, params?: Record<string, string | number>) => string;

/**
 * Format the oldest pending scheduledFor as a relative-age string. Returns
 * the locale-aware "—" when the queue is empty.
 */
function formatOldest(at: string | null, t: Translator): string {
  if (at === null) return t('oldestNone');
  const ms = Date.now() - new Date(at).getTime();
  if (ms < 60_000) return t('oldestJustNow');
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    return t('oldestMinutes', { m });
  }
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    return t('oldestHours', { h });
  }
  const d = Math.floor(ms / 86_400_000);
  return t('oldestDays', { d });
}