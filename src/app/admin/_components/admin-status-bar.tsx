'use client';

import { useEffect, useState } from 'react';

export interface AdminStatusBarData {
  dbPingMs: number;
  queueDepth: number;
  schedulerState: 'RUNNING' | 'PAUSED';
  recentAuditCount: number;
  user: { email: string; role: string };
  variant: string;
  fetchedAt: string;
}

interface Props {
  initialData: AdminStatusBarData;
}

/**
 * Persistent bottom status bar (Mission Control variant only).
 *
 * Renders 4 columns: DB ping · Queue depth · Scheduler state · Recent audit
 * count. Polls /api/admin/status every 10 seconds. Falls back to initialData
 * on poll error (network/401). Visually distinct per variant via
 * `data-admin` (the parent sets it on the wrapper) — these classes read the
 * tokens.
 */
export function AdminStatusBar({ initialData }: Props): JSX.Element {
  const [data, setData] = useState<AdminStatusBarData>(initialData);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/admin/status', { cache: 'no-store' });
        if (!res.ok) return;
        const fresh = (await res.json()) as AdminStatusBarData;
        if (!cancelled) setData(fresh);
      } catch {
        // network error — keep last good data
      }
    };
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const toneClass = data.schedulerState === 'PAUSED' ? 'ghc-admin-statusbar-tone-warn' : 'ghc-admin-statusbar-tone-ok';

  return (
    <div className={`ghc-admin-statusbar ${toneClass}`} data-fetched-at={data.fetchedAt}>
      <div className="ghc-admin-statusbar-col">
        <span className="ghc-admin-statusbar-label">DB</span>
        <span className="ghc-admin-statusbar-value">{data.dbPingMs} ms</span>
      </div>
      <div className="ghc-admin-statusbar-col">
        <span className="ghc-admin-statusbar-label">Queue</span>
        <span className="ghc-admin-statusbar-value">{data.queueDepth}</span>
      </div>
      <div className="ghc-admin-statusbar-col">
        <span className="ghc-admin-statusbar-label">Scheduler</span>
        <span className="ghc-admin-statusbar-value">{data.schedulerState}</span>
      </div>
      <div className="ghc-admin-statusbar-col">
        <span className="ghc-admin-statusbar-label">Audit 24h</span>
        <span className="ghc-admin-statusbar-value">{data.recentAuditCount}</span>
      </div>
      <div className="ghc-admin-statusbar-col ghc-admin-statusbar-meta">
        <span className="ghc-admin-statusbar-label">Operator</span>
        <span className="ghc-admin-statusbar-value">{data.user.email}</span>
        <span className="ghc-admin-statusbar-sub">{data.user.role} · {data.variant}</span>
      </div>
    </div>
  );
}