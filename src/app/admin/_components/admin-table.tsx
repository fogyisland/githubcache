import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { AdminEmptyState } from './admin-empty-state';

export interface AdminColumn<T> {
  /** Unique key (used for test id + key). */
  key: string;
  /** Column header label. */
  header: string;
  /** Render function for cell content. */
  render: (row: T) => ReactNode;
  /** Optional CSS width (e.g. '120px', '20%'). */
  width?: string;
  /** Cell text alignment. */
  align?: 'left' | 'right';
}

export interface AdminTablePagination {
  total: number;
  limit: number;
  offset: number;
  basePath: string;
}

interface Props<T> {
  columns: AdminColumn<T>[];
  rows: T[];
  /** Empty-state title when rows is empty (and not loading). */
  emptyTitle?: string;
  /** Empty-state description. */
  emptyDescription?: string;
  /** Empty-state CTA. */
  emptyAction?: ReactNode;
  /** Empty-state icon glyph. */
  emptyIcon?: ReactNode;
  /** Loading skeleton when true. */
  isLoading?: boolean;
  /** When set, generates Prev/Next links + range display. */
  pagination?: AdminTablePagination;
  /** When provided, each row wraps in a `<Link href={...}>`. */
  rowHref?: (row: T) => string;
  /** ARIA label for the table. */
  ariaLabel?: string;
}

/**
 * Generic typed admin table. Theme-aware via `ghc-admin-table` class.
 *
 * Renders:
 * - Header row + body rows from `columns` + `rows`
 * - Empty state (AdminEmptyState) when rows is empty and not loading
 * - Loading skeleton (5 ghost rows) when isLoading
 * - Pagination footer with Prev/Next + range when pagination prop is set
 * - Each row as a `<Link>` when rowHref is provided
 */
export function AdminTable<T>({
  columns,
  rows,
  emptyTitle = 'No records',
  emptyDescription,
  emptyAction,
  emptyIcon = '•',
  isLoading = false,
  pagination,
  rowHref,
  ariaLabel,
}: Props<T>): ReactElement {
  if (isLoading) {
    return (
      <div className="ghc-admin-table-wrap">
        <table className="ghc-admin-table" aria-label={ariaLabel}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={c.align === 'right' ? 'text-right' : ''}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={`sk-${i}`} className="ghc-admin-skeleton-row">
                {columns.map((c) => (
                  <td key={c.key}>
                    <span className="ghc-admin-skeleton" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <AdminEmptyState
        icon={<span>{emptyIcon}</span>}
        title={emptyTitle}
        {...(emptyDescription !== undefined ? { description: emptyDescription } : {})}
        {...(emptyAction !== undefined ? { action: emptyAction } : {})}
      />
    );
  }

  return (
    <div className="ghc-admin-table-wrap">
      <table className="ghc-admin-table" aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={c.align === 'right' ? 'text-right' : ''}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => {
            const cells = columns.map((c) => (
              <td
                key={c.key}
                className={c.align === 'right' ? 'text-right' : ''}
                data-col={c.key}
              >
                {c.render(row)}
              </td>
            ));
            if (rowHref) {
              return (
                <tr key={rowIdx} className="ghc-admin-table-row-link">
                  {columns.map((c, i) => (
                    <td key={c.key} className={c.align === 'right' ? 'text-right' : ''}>
                      {i === 0 ? (
                        <Link href={rowHref(row)} className="ghc-admin-table-link">
                          {c.render(row)}
                        </Link>
                      ) : (
                        c.render(row)
                      )}
                    </td>
                  ))}
                </tr>
              );
            }
            return (
              <tr key={rowIdx} className="ghc-admin-table-row">
                {cells}
              </tr>
            );
          })}
        </tbody>
      </table>
      {pagination ? <Pagination {...pagination} /> : null}
    </div>
  );
}

function Pagination({
  total,
  limit,
  offset,
  basePath,
}: AdminTablePagination): ReactElement {
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;

  return (
    <div className="ghc-admin-pagination">
      <span className="ghc-admin-pagination-range">
        {start}–{end} of {total}
      </span>
      <div className="ghc-admin-pagination-links">
        {hasPrev ? (
          <Link
            href={`${basePath}?offset=${prevOffset}`}
            className="ghc-btn-ghost"
            rel="prev"
          >
            ← Prev
          </Link>
        ) : (
          <span className="ghc-btn-ghost is-disabled">← Prev</span>
        )}
        {hasNext ? (
          <Link
            href={`${basePath}?offset=${nextOffset}`}
            className="ghc-btn-ghost"
            rel="next"
          >
            Next →
          </Link>
        ) : (
          <span className="ghc-btn-ghost is-disabled">Next →</span>
        )}
      </div>
    </div>
  );
}