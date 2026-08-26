import type { ReactElement } from 'react';

export type AdminKpiTone = 'default' | 'positive' | 'negative';

interface Props {
  label: string;
  value: number | string;
  hint?: string;
  tone?: AdminKpiTone;
}

/**
 * Single KPI card. Replaces the hardcoded gray-200 one in reports.
 *
 * Theme-aware via ghc-admin-kpi class — colors come from the public theme
 * tokens (--color-surface, --color-rule, --color-ink, --color-accent).
 *
 * Numeric `value` is formatted with `toLocaleString()`. String `value` is
 * rendered as-is (used for pre-formatted strings like `"42 ms"` or `"92%"`).
 */
export function AdminKpiCard({ label, value, hint, tone = 'default' }: Props): ReactElement {
  const display = typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <div className="ghc-admin-kpi">
      <div className="ghc-admin-kpi-label">{label}</div>
      <div className={`ghc-admin-kpi-value tone-${tone}`}>{display}</div>
      {hint ? <div className="ghc-admin-kpi-hint">{hint}</div> : null}
    </div>
  );
}