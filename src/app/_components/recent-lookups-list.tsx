import Link from 'next/link';
import type { Repository } from '@prisma/client';
import { getDescription, getLanguage, getStars } from '@/lib/repo/metadata';

interface Props {
  repos: Repository[];
}

function timeAgo(d: Date | null): string {
  if (!d) return '–';
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function RecentLookupsList({ repos }: Props) {
  if (repos.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white/60 px-6 py-12 text-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="mx-auto h-10 w-10 text-slate-300"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <p className="mt-3 text-sm text-slate-500">
          No repositories cached yet. Try submitting a repo above.
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
                <span className="truncate font-mono text-sm font-semibold text-slate-900">
                  {r.owner}/{r.name}
                </span>
                <span className="shrink-0 text-xs text-slate-500" title={r.lastFetchedAt?.toISOString()}>
                  {timeAgo(r.lastFetchedAt)}
                </span>
              </div>
              {typeof description === 'string' && description.length > 0 && (
                <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{description}</p>
              )}
              <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  {typeof language === 'string' && language && (
                    <span className="ghc-chip bg-blue-50 text-blue-700">{language}</span>
                  )}
                </div>
                {typeof stars === 'number' && (
                  <span className="font-medium text-slate-700">★ {stars.toLocaleString()}</span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
