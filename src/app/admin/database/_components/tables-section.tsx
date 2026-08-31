'use client';

import { useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';

export interface TableStat {
  model: string;
  table: string;
  rowCount: number;
  bytes: number;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface TableDetail {
  table: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  rowCount: number;
  bytes: number;
}

interface Props {
  stats: TableStat[];
  details: TableDetail[];
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1)} ${units[u]}`;
}

/**
 * M17 — Table list on /admin/database. Each row is collapsible to
 * show the columns + indexes (sourced from information_schema). The
 * top-level stats column comes from getTableStats() (one
 * information_schema query) and the per-table detail is from
 * getTableDetails() (26 queries total). Passes both as props from
 * the server component to keep this client surface focused on UI.
 */
export function TablesSection({ stats, details }: Props): ReactElement {
  const t = useTranslations('admin.database.tables');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const detailByName = new Map(details.map((d) => [d.table, d]));

  function toggle(table: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  }

  return (
    <section className="ghc-admin-section">
      <h2 className="ghc-admin-section-title">{t('heading')}</h2>
      <table className="ghc-admin-table">
        <thead>
          <tr>
            <th>{t('column.model')}</th>
            <th>{t('column.table')}</th>
            <th className="ghc-admin-num">{t('column.rows')}</th>
            <th className="ghc-admin-num">{t('column.size')}</th>
            <th aria-label="schema" />
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => {
            const isOpen = expanded.has(s.table);
            const detail = detailByName.get(s.table);
            return (
              <>
                <tr key={s.table}>
                  <td>{s.model}</td>
                  <td>
                    <code className="ghc-code-inline">{s.table}</code>
                  </td>
                  <td className="ghc-admin-num">{s.rowCount.toLocaleString()}</td>
                  <td className="ghc-admin-num">{formatBytes(s.bytes)}</td>
                  <td>
                    <button
                      type="button"
                      className="ghc-btn ghc-btn-small"
                      onClick={() => toggle(s.table)}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? t('collapse') : t('expand')}
                    </button>
                  </td>
                </tr>
                {isOpen && detail ? (
                  <tr key={`${s.table}-detail`}>
                    <td colSpan={5} className="ghc-admin-detail-cell">
                      <div className="ghc-admin-detail-grid">
                        <div>
                          <strong>{t('column.columns')}</strong>
                          <ul>
                            {detail.columns.map((c) => (
                              <li key={c.name}>
                                <code className="ghc-code-inline">{c.name}</code>{' '}
                                <span className="ghc-admin-muted">{c.dataType}</span>
                                {c.isPrimaryKey ? (
                                  <span className="ghc-admin-badge">{t('primaryKey')}</span>
                                ) : null}
                                {!c.nullable ? (
                                  <span className="ghc-admin-badge">{t('notNull')}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <strong>{t('column.indexes')}</strong>
                          {detail.indexes.length === 0 ? (
                            <p className="ghc-admin-muted">{t('indexesEmpty')}</p>
                          ) : (
                            <ul>
                              {detail.indexes.map((i) => (
                                <li key={i.name}>
                                  <code className="ghc-code-inline">{i.name}</code>{' '}
                                  <span className="ghc-admin-muted">
                                    ({i.columns.join(', ')}
                                    {i.unique ? ', UNIQUE' : ''})
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
