import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { formatDateTime } from '@/lib/format/datetime';
import type { TimezoneId } from '@/lib/timezone/registry';

interface Row {
  id: string;
  createdAt: Date;
  action: string;
  targetType: string;
  targetId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  ip: string | null;
  metadata: unknown;
}

interface Props {
  rows: Row[];
  total: number;
  limit: number;
  offset: number;
  tz: TimezoneId;
}

/**
 * Server-rendered audit log table. Shows rows, the current range, and
 * prev/next pagination controls.
 *
 * TODO(M7.5): Prev/next currently preserves only `offset`+`limit` — filters
 * reset on pagination. Future polish: preserve all filters in prev/next
 * href builders.
 */
export async function AuditTable({ rows, total, limit, offset, tz }: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.audit.table');
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = end < total;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const pageNum = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm text-gray-600">
        {t('showingRange', { start: start.toLocaleString(), end: end.toLocaleString(), total: total.toLocaleString() })}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="py-2">{t('column.when')}</th>
                <th className="py-2">{t('column.action')}</th>
                <th className="py-2">{t('column.actor')}</th>
                <th className="py-2">{t('column.target')}</th>
                <th className="py-2">{t('column.ip')}</th>
                <th className="py-2">{t('column.metadata')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 align-top">
                  <td className="py-2 font-mono text-xs whitespace-nowrap">
                    {formatDateTime(r.createdAt, tz)}
                  </td>
                  <td className="py-2">
                    <span className="rounded bg-gray-100 px-2 py-1 font-mono text-xs">
                      {r.action}
                    </span>
                  </td>
                  <td className="py-2">
                    {r.actorEmail ? (
                      <div>
                        <div>{r.actorEmail}</div>
                        <div className="font-mono text-xs text-gray-500">#{r.actorUserId}</div>
                      </div>
                    ) : r.actorUserId ? (
                      <span className="font-mono text-xs">#{r.actorUserId}</span>
                    ) : (
                      <span className="text-gray-400">{t('system')}</span>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="font-mono text-xs">{r.targetType}</div>
                    <div className="font-mono text-xs text-gray-500">{r.targetId}</div>
                  </td>
                  <td className="py-2 font-mono text-xs">{r.ip ?? t('dash')}</td>
                  <td className="py-2">
                    <code className="block max-w-md overflow-x-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-2 text-xs">
                      {JSON.stringify(r.metadata, null, 2)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <a
          href={`?offset=${prevOffset}&limit=${limit}`}
          className={`rounded border border-gray-300 bg-white px-3 py-1 text-sm ${
            !hasPrev ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'
          }`}
          aria-disabled={!hasPrev}
        >
          {t('prev')}
        </a>
        <span className="text-sm text-gray-600">
          {t('pageOf', { page: pageNum, total: totalPages })}
        </span>
        <a
          href={`?offset=${nextOffset}&limit=${limit}`}
          className={`rounded border border-gray-300 bg-white px-3 py-1 text-sm ${
            !hasNext ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'
          }`}
          aria-disabled={!hasNext}
        >
          {t('next')}
        </a>
      </div>
    </div>
  );
}
