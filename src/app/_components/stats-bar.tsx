'use client';

import { useEffect, useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

interface StatusBody {
  repositories: { total: number; ok: number };
  tokens: { active: number };
  queue: { done: number };
}

interface Stat {
  label: string;
  value: number;
  hint: string;
}

function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function StatCell({ stat }: { stat: Stat }): JSX.Element {
  const v = useCountUp(stat.value);
  return (
    <div className="ghc-stat-cell">
      <div className="ghc-stat-number" data-testid="ghc-stat-value">
        {v.toLocaleString()}
      </div>
      <div className="ghc-stat-label">{stat.label}</div>
      <div className="ghc-stat-hint">{stat.hint}</div>
    </div>
  );
}

/**
 * 4-stat strip shown beneath the hero. Client component: fetches
 * /api/v1/status on mount, animates each number from 0 with a CSS
 * cubic-ease via requestAnimationFrame. Renders 0s immediately so the
 * layout doesn't shift while the fetch is in flight.
 */
export function StatsBar(): JSX.Element {
  const t = useTranslations('home.stats');
  const [stats, setStats] = useState<StatusBody | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/v1/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: StatusBody | null) => {
        if (!cancelled) setStats(body);
      })
      .catch(() => {
        /* keep null → zeroes */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cells: Stat[] = stats ? [
    { label: t('cachedRepositories'), value: stats.repositories.total, hint: t('cachedRepositoriesHint') },
    { label: t('healthyRepos'), value: stats.repositories.ok, hint: t('healthyReposHint') },
    { label: t('activeTokens'), value: stats.tokens.active, hint: t('activeTokensHint') },
    { label: t('refreshes'), value: stats.queue.done, hint: t('refreshesHint') },
  ] : [
    { label: t('cachedRepositories'), value: 0, hint: t('cachedRepositoriesHint') },
    { label: t('healthyRepos'), value: 0, hint: t('healthyReposHint') },
    { label: t('activeTokens'), value: 0, hint: t('activeTokensHint') },
    { label: t('refreshes'), value: 0, hint: t('refreshesHint') },
  ];

  return (
    <section className="ghc-stats-bar" data-testid="ghc-stats-bar">
      {cells.map((s) => (
        <StatCell key={s.label} stat={s} />
      ))}
    </section>
  );
}
