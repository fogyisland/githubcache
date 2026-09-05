'use client';

import { useEffect, useState } from 'react';

/**
 * Live clock for the admin top utility bar (M24 Wulan signature).
 *
 * Renders UTC + viewer's local time side-by-side, ticking every second.
 * Client component (uses Date.now() + setInterval). SSR renders a static
 * placeholder so the bar still lays out correctly before hydration.
 *
 * Why UTC + local: operators schedule refreshes / read audit logs in UTC,
 * but reason about deadlines in their own timezone. Showing both at a
 * glance avoids mental math.
 */
export function AdminClock(): React.ReactElement {
  const [now, setNow] = useState<Date | null>(null);

  // Defer the initial setState via setTimeout(0) to satisfy the React 19
  // "no synchronous setState in effect" rule. The setInterval updates are
  // already async by nature.
  useEffect(() => {
    const initId = setTimeout(() => setNow(new Date()), 0);
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearTimeout(initId);
      clearInterval(id);
    };
  }, []);

  if (!now) {
    // SSR placeholder — same width as hydrated output to avoid layout shift.
    return (
      <span className="ghc-admin-clock" aria-hidden="true">
        <span className="ghc-admin-clock-label">UTC</span>
        <span className="ghc-admin-clock-time">--:--:--</span>
        <span className="ghc-admin-clock-sep">·</span>
        <span className="ghc-admin-clock-label">本地</span>
        <span className="ghc-admin-clock-time">--:--:--</span>
      </span>
    );
  }

  return (
    <span className="ghc-admin-clock" aria-label={`当前时间：UTC ${formatUtc(now)}，本地 ${formatLocal(now)}`}>
      <span className="ghc-admin-clock-label">UTC</span>
      <time className="ghc-admin-clock-time" dateTime={now.toISOString()}>
        {formatUtc(now)}
      </time>
      <span className="ghc-admin-clock-sep" aria-hidden="true">·</span>
      <span className="ghc-admin-clock-label">本地</span>
      <time className="ghc-admin-clock-time" dateTime={now.toISOString()}>
        {formatLocal(now)}
      </time>
    </span>
  );
}

function formatUtc(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function formatLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
