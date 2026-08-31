import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

export interface QueueJobRow {
  id: string;
  repositoryId: string;
  repository: { owner: string; name: string };
  priority: number;
  scheduledFor: string;
  attempts: number;
  updatedAt: string;
  lastError: string | null;
}

interface Props {
  pending: QueueJobRow[];
  inProgress: QueueJobRow[];
  done24h: QueueJobRow[];
  failed24h: QueueJobRow[];
}

const STATUS_LABEL_KEY: Record<'pending' | 'inProgress' | 'done' | 'failed', string> = {
  pending: 'pendingHeading',
  inProgress: 'inProgressHeading',
  done: 'doneHeading',
  failed: 'failedHeading',
};

/**
 * Four status sections stacked vertically for /admin/queue (M20.7).
 * Each capped at 50 rows by the caller. Each row shows:
 *   job id · owner/name · priority · scheduled/updated · attempts · last error
 */
export async function QueueSections({
  pending,
  inProgress,
  done24h,
  failed24h,
}: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.queue.sections');

  const sections: Array<{
    key: 'pending' | 'inProgress' | 'done' | 'failed';
    rows: QueueJobRow[];
    when: 'scheduled' | 'updated';
  }> = [
    { key: 'pending', rows: pending, when: 'scheduled' },
    { key: 'inProgress', rows: inProgress, when: 'updated' },
    { key: 'done', rows: done24h, when: 'updated' },
    { key: 'failed', rows: failed24h, when: 'updated' },
  ];

  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <QueueSection
          key={s.key}
          title={t(STATUS_LABEL_KEY[s.key])}
          rows={s.rows}
          when={s.when}
          t={t}
        />
      ))}
    </div>
  );
}

interface SectionProps {
  title: string;
  rows: QueueJobRow[];
  when: 'scheduled' | 'updated';
  t: Awaited<ReturnType<typeof getTranslations<'admin.queue.sections'>>>;
}

async function QueueSection({
  title,
  rows,
  when,
  t,
}: SectionProps): Promise<ReactElement> {
  const truncate = (s: string | null, n: number): string =>
    s === null
      ? t('dash')
      : s.length > n
        ? `${s.slice(0, n)}…`
        : s;
  const fmtTs = (iso: string): string => iso.replace('T', ' ').slice(0, 19);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold">
        {title}{' '}
        <span className="text-sm font-normal text-gray-500">
          ({rows.length.toLocaleString()})
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="py-2">{t('column.id')}</th>
                <th className="py-2">{t('column.repo')}</th>
                <th className="py-2 text-right">{t('column.priority')}</th>
                <th className="py-2 text-right">
                  {when === 'scheduled' ? t('column.scheduled') : t('column.updated')}
                </th>
                <th className="py-2 text-right">{t('column.attempts')}</th>
                <th className="py-2">{t('column.error')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="py-2 font-mono text-xs">#{r.id}</td>
                  <td className="py-2 font-mono text-xs">
                    {r.repository.owner}/{r.repository.name}
                  </td>
                  <td className="py-2 text-right">{r.priority}</td>
                  <td className="py-2 text-right font-mono text-xs">
                    {fmtTs(when === 'scheduled' ? r.scheduledFor : r.updatedAt)}
                  </td>
                  <td className="py-2 text-right">{r.attempts}</td>
                  <td className="py-2 font-mono text-xs text-gray-600">
                    {truncate(r.lastError, 80)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}