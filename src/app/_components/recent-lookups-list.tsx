import Link from 'next/link';
import type { Repository } from '@prisma/client';

interface Props {
  repos: Repository[];
}

function pickMeta(meta: unknown, key: string): unknown {
  if (typeof meta !== 'object' || meta === null) return undefined;
  return (meta as Record<string, unknown>)[key];
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
      <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
        No repositories cached yet. Try submitting a repo above.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {repos.map((r) => {
        const meta = r.metadata;
        const description = pickMeta(meta, 'description');
        const language = pickMeta(meta, 'language');
        const stars = pickMeta(meta, 'stargazers_count');
        const href = `/repo/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;
        return (
          <li key={r.id.toString()}>
            <Link
              href={href}
              className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-sm font-semibold text-gray-900">
                  {r.owner}/{r.name}
                </span>
                <span className="shrink-0 text-xs text-gray-500">
                  {timeAgo(r.lastFetchedAt)}
                </span>
              </div>
              {typeof description === 'string' && description.length > 0 && (
                <p className="mt-1 line-clamp-2 text-sm text-gray-700">{description}</p>
              )}
              <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                {typeof language === 'string' && language && (
                  <span className="rounded bg-gray-100 px-2 py-0.5">{language}</span>
                )}
                {typeof stars === 'number' && <span>★ {stars.toLocaleString()}</span>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
