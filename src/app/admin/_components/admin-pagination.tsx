import type { ReactElement } from 'react';

/**
 * Shared pagination control for admin list pages (M14.2).
 *
 * Renders "Showing N–M of T" + prev / next links. The links preserve the
 * caller's existing filter params via `extraSearch` so filters survive
 * pagination. `hrefBuilder` lets the caller customize the URL (e.g. a
 * different base path) — by default we use the current path with the
 * provided search-params.
 *
 * Disabled-when-at-bound semantics:
 *   - prev is disabled when offset === 0
 *   - next is disabled when offset + rows.length >= total
 *
 * `label` is the translated text for "Showing N–M of T" — caller provides
 * the i18n string so the component is namespace-agnostic.
 */
export interface AdminPaginationProps {
  basePath: string;
  /** Current page offset (rows already skipped). */
  offset: number;
  /** Current page size. */
  limit: number;
  /** Total matching rows across all pages. */
  total: number;
  /** Rows rendered on the current page (used to compute the displayed range). */
  rowsOnPage: number;
  /** Translated "Showing N–M of T" string; vars from caller. */
  label: string;
  /** Any extra search params to preserve across pagination (e.g. role, status). */
  extraSearch?: Record<string, string>;
}

export function AdminPagination({
  basePath,
  offset,
  limit,
  total,
  rowsOnPage,
  label,
  extraSearch = {},
}: AdminPaginationProps): ReactElement | null {
  if (total === 0) return null;
  const end = offset + rowsOnPage;
  const hasPrev = offset > 0;
  const hasNext = end < total;

  function hrefFor(newOffset: number): string {
    const params = new URLSearchParams({ ...extraSearch });
    params.set('limit', String(limit));
    params.set('offset', String(newOffset));
    return `${basePath}?${params.toString()}`;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
      <p aria-live="polite">{label}</p>
      <nav className="flex gap-2" aria-label="Pagination">
        {hasPrev ? (
          <a
            href={hrefFor(Math.max(0, offset - limit))}
            className="rounded border border-gray-300 bg-white px-3 py-1 hover:bg-gray-50"
          >
            ←
          </a>
        ) : (
          <span
            className="cursor-not-allowed rounded border border-gray-200 bg-gray-50 px-3 py-1 text-gray-400"
            aria-disabled="true"
          >
            ←
          </span>
        )}
        {hasNext ? (
          <a
            href={hrefFor(offset + limit)}
            className="rounded border border-gray-300 bg-white px-3 py-1 hover:bg-gray-50"
          >
            →
          </a>
        ) : (
          <span
            className="cursor-not-allowed rounded border border-gray-200 bg-gray-50 px-3 py-1 text-gray-400"
            aria-disabled="true"
          >
            →
          </span>
        )}
      </nav>
    </div>
  );
}