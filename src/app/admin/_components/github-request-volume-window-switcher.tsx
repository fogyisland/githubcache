import Link from 'next/link';
import type { ReactElement } from 'react';

interface Props {
  basePath: string;
  current: '24h' | '7d';
  /**
   * Other URL searchParams to preserve when the user toggles the window.
   * The `window` key is always overwritten, never carried over from this
   * object.
   */
  preserved?: Record<string, string | undefined>;
}

/**
 * M32.7.6 — two-pill window switcher for the GitHub request volume chart.
 * Pure SSR (no client JS) — uses next/link to round-trip the page with a
 * different ?window= searchParam. The active pill is marked via
 * aria-current="page" so screen readers announce the current selection.
 */
export function GithubRequestVolumeWindowSwitcher({
  basePath,
  current,
  preserved = {},
}: Props): ReactElement {
  const buildHref = (w: '24h' | '7d'): string => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(preserved)) {
      if (v !== undefined && k !== 'window') params.set(k, v);
    }
    params.set('window', w);
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
      <Link
        href={buildHref('24h')}
        aria-current={current === '24h' ? 'page' : undefined}
        className={`px-3 py-1 text-sm rounded ${
          current === '24h'
            ? 'bg-indigo-50 text-indigo-700'
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        24h
      </Link>
      <Link
        href={buildHref('7d')}
        aria-current={current === '7d' ? 'page' : undefined}
        className={`px-3 py-1 text-sm rounded ${
          current === '7d'
            ? 'bg-indigo-50 text-indigo-700'
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        7d
      </Link>
    </div>
  );
}
