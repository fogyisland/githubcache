import type { ReactElement } from 'react';

export interface QuotaBarToken {
  id: string;
  label: string;
  requestsUsed: number;
  requestsLimit: number;
}

interface Props {
  tokens: QuotaBarToken[];
  /** Optional accessible label for the SVG (defaults to a generic phrase). */
  ariaLabel?: string;
}

const SVG_WIDTH = 100;
const SVG_HEIGHT = 24;

/**
 * M32 — Stacked horizontal quota bar showing each token's share of
 * remaining GitHub API budget.
 *
 * Layout:
 *   - One horizontal slice per token; width = limit / totalLimit.
 *   - Each slice shows used portion filled, remaining portion outlined.
 *   - Fill color escalates with usage: green < 50%, amber 50–79%, red ≥ 80%.
 *   - Legend below the bar: "#<id> <label> ▓▓▓░░░ 53% (3,200/6,000)".
 *
 * Pure server component, no JS shipped. Token list comes from the
 * server-rendered page; nothing here depends on the browser.
 */
export function QuotaBar({ tokens, ariaLabel = 'Token quota usage' }: Props): ReactElement | null {
  if (tokens.length === 0) return null;

  const totalLimit = tokens.reduce((sum, t) => sum + t.requestsLimit, 0);

  // Stable ordering by id so the SVG slice order matches the legend order.
  const ordered = [...tokens].sort((a, b) => (a.id < b.id ? -1 : 1));

  let cursor = 0;
  const slices = ordered.map((t) => {
    const widthPct = totalLimit > 0 ? (t.requestsLimit / totalLimit) * SVG_WIDTH : 0;
    const usedPct =
      t.requestsLimit > 0 ? Math.min(1, t.requestsUsed / t.requestsLimit) : 0;
    const fillWidth = widthPct * usedPct;
    const slice = { x: cursor, width: widthPct, fillWidth, token: t };
    cursor += widthPct;
    return slice;
  });

  return (
    <div className="ghc-quota-bar">
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        preserveAspectRatio="none"
        className="ghc-quota-bar-svg"
      >
        {slices.map((s) => {
          const pct = s.token.requestsLimit > 0
            ? s.token.requestsUsed / s.token.requestsLimit
            : 0;
          const variant =
            pct >= 0.8 ? 'danger' : pct >= 0.5 ? 'warn' : 'ok';
          return (
            <g key={s.token.id}>
              {/* Background outline (unused portion) */}
              <rect
                x={s.x}
                y={0}
                width={s.width}
                height={SVG_HEIGHT}
                fill="none"
                stroke="currentColor"
                strokeWidth={0.5}
                opacity={0.3}
              />
              {/* Filled portion (used) */}
              {s.fillWidth > 0 ? (
                <rect
                  x={s.x}
                  y={0}
                  width={s.fillWidth}
                  height={SVG_HEIGHT}
                  className={`ghc-quota-bar-fill ghc-quota-bar-fill-${variant}`}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <ul className="ghc-quota-bar-legend">
        {ordered.map((t) => {
          const pct =
            t.requestsLimit > 0
              ? Math.round((t.requestsUsed / t.requestsLimit) * 100)
              : 0;
          return (
            <li key={t.id} className="ghc-quota-bar-legend-row">
              <span className="ghc-quota-bar-legend-id">#{t.id}</span>
              <span className="ghc-quota-bar-legend-label">{t.label}</span>
              <span className="ghc-quota-bar-legend-meta">
                {t.requestsUsed.toLocaleString()} / {t.requestsLimit.toLocaleString()}{' '}
                ({pct}%)
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}