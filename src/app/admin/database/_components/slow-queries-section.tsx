'use client';

import type { ReactElement } from 'react';
import { useTranslations } from 'next-intl';

export interface SlowQueryRow {
  digest: string;
  calls: number;
  totalSeconds: number;
  avgSeconds: number;
  rowsSent: number;
  sampleSql: string;
}

export type SlowQueriesResult =
  | { kind: 'ok'; rows: SlowQueryRow[] }
  | { kind: 'no_permission'; reason: string };

interface Props {
  result: SlowQueriesResult;
  limit: number;
}

function formatSeconds(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '—';
  if (s < 1) return `${(s * 1000).toFixed(1)} ms`;
  return `${s.toFixed(2)} s`;
}

/**
 * M17 — Slow-queries panel on /admin/database. Shows top N
 * statements by total wait time from
 * performance_schema.events_statements_summary_by_digest. If the
 * DB user lacks PROCESS privilege the helper returns
 * `kind: 'no_permission'` and we surface a hint instead of a table.
 */
export function SlowQueriesSection({ result, limit }: Props): ReactElement {
  const t = useTranslations('admin.database.slowQueries');

  return (
    <section className="ghc-admin-section">
      <h2 className="ghc-admin-section-title">{t('heading', { limit })}</h2>

      {result.kind === 'no_permission' ? (
        <div className="ghc-admin-warn-banner" role="status">
          {t('noPermission', { reason: result.reason })}
        </div>
      ) : result.rows.length === 0 ? (
        <p className="ghc-admin-empty">{t('empty')}</p>
      ) : (
        <table className="ghc-admin-table">
          <thead>
            <tr>
              <th className="ghc-admin-num">{t('column.calls')}</th>
              <th className="ghc-admin-num">{t('column.total')}</th>
              <th className="ghc-admin-num">{t('column.avg')}</th>
              <th className="ghc-admin-num">{t('column.rowsSent')}</th>
              <th>{t('column.sample')}</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.digest}>
                <td className="ghc-admin-num">{r.calls.toLocaleString()}</td>
                <td className="ghc-admin-num">{formatSeconds(r.totalSeconds)}</td>
                <td className="ghc-admin-num">{formatSeconds(r.avgSeconds)}</td>
                <td className="ghc-admin-num">{r.rowsSent.toLocaleString()}</td>
                <td>
                  <code className="ghc-code-inline">{truncate(r.sampleSql, 200)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
