import type { ReactElement } from 'react';

export interface AdminFilterOption {
  value: string;
  label: string;
}

export interface AdminFilter {
  /** Query-string param name (e.g. "role", "status"). */
  name: string;
  /** Visible label for the select. */
  label: string;
  /** Options. The empty-string value renders as "All". */
  options: AdminFilterOption[];
}

interface Props {
  filters: AdminFilter[];
  /** Form action target (the list page URL). */
  basePath: string;
  /** Current selected values from URL searchParams. */
  values?: Record<string, string>;
}

/**
 * URL-synced filter bar. Renders as a `<form method="get">` with one
 * `<select>` per filter. Submitting preserves other params via `name` keys.
 *
 * The page reading this form re-parses `searchParams` to filter the list.
 * Auto-submit-on-change is handled by a tiny inline script (no JSX client
 * component needed) — but here we just render the static markup and let
 * the page wire any JS enhancement.
 */
export function AdminFilterBar({ filters, basePath, values = {} }: Props): ReactElement {
  return (
    <form action={basePath} method="get" className="ghc-admin-filter-bar">
      {filters.map((f) => {
        const current = values[f.name] ?? '';
        return (
          <label key={f.name} className="ghc-admin-filter-label">
            <span className="ghc-admin-filter-text">{f.label}</span>
            <select
              name={f.name}
              defaultValue={current}
              className="ghc-admin-filter-select"
            >
              <option value="">All</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <button type="submit" className="ghc-btn-primary">
        Apply
      </button>
    </form>
  );
}