import Link from 'next/link';
import type { ReactElement } from 'react';
import type { Repository } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { getDescription, getLanguage, getStars } from '@/lib/repo/metadata';

interface Props {
  repos: Repository[];
}

export async function RecentLookupsList({ repos }: Props): Promise<ReactElement> {
  const t = await getTranslations('home');
  const tTime = await getTranslations('home.timeAgo');

  function timeAgo(d: Date | null): string {
    if (!d) return tTime('dash');
    // Date.now() is impure but is acceptable in this server-render context
    // (server components run once during SSR; purity enforcement doesn't apply).
    // eslint-disable-next-line react-hooks/purity
    const ms = Date.now() - d.getTime();
    if (ms < 60_000) return tTime('justNow');
    if (ms < 3_600_000) return tTime('minutesAgo', { m: Math.floor(ms / 60_000) });
    if (ms < 86_400_000) return tTime('hoursAgo', { h: Math.floor(ms / 3_600_000) });
    return tTime('daysAgo', { d: Math.floor(ms / 86_400_000) });
  }

  if (repos.length === 0) {
    return (
      <div className="ghc-card border-dashed p-12 text-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="mx-auto h-10 w-10 text-[color:var(--color-ink-muted)]"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <p className="mt-3 text-sm text-[color:var(--color-ink-muted)]">
          {t('recent.empty')}
        </p>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {repos.map((r) => {
        const meta = r.metadata;
        const description = getDescription(meta);
        const language = getLanguage(meta);
        const stars = getStars(meta);
        const href = `/repo/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;
        return (
          <li key={r.id.toString()}>
            <Link
              href={href}
              className="ghc-card ghc-card-hover block h-full p-4 no-underline"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-sm font-semibold">
                  {r.owner}/{r.name}
                </span>
                <span
                  className="shrink-0 text-xs text-[color:var(--color-ink-muted)]"
                  title={r.lastFetchedAt?.toISOString()}
                >
                  {timeAgo(r.lastFetchedAt)}
                </span>
              </div>
              {description && (
                <p className="mt-1.5 line-clamp-2 text-sm text-[color:var(--color-ink-muted)]">
                  {description}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  {language && <span className="ghc-chip">{language}</span>}
                </div>
                {stars !== null && (
                  <span className="font-medium">{t('recent.starsPrefix')}{stars.toLocaleString()}</span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
