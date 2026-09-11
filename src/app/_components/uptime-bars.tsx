import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

export interface DayStatus {
  date: string; // ISO yyyy-mm-dd
  ok: boolean;
}

interface Props {
  days: DayStatus[];
}

/**
 * 90-day uptime bar chart. Each cell = 1 day; green = ok, red = degraded.
 * Renders as a horizontal strip of cells; cell tooltip on hover via title attr.
 *
 * Pure presentational server component — the caller (e.g. /status) owns
 * the data source. M29 task 4 currently passes a stub series derived
 * from the latest snapshot (see task-4 report).
 */
export async function UptimeBars({ days }: Props): Promise<ReactElement> {
  const t = await getTranslations('status');
  return (
    <div className="ghc-uptime-bars" data-testid="ghc-uptime-bars">
      <div className="ghc-uptime-bars-label">{t('uptime90d')}</div>
      <div className="ghc-uptime-bars-grid">
        {days.map((d) => (
          <span
            key={d.date}
            className="ghc-uptime-bar"
            data-state={d.ok ? 'ok' : 'fail'}
            title={`${d.date}: ${d.ok ? t('uptimeOk') : t('uptimeFail')}`}
            aria-label={`${d.date}: ${d.ok ? t('uptimeOk') : t('uptimeFail')}`}
          />
        ))}
      </div>
    </div>
  );
}
