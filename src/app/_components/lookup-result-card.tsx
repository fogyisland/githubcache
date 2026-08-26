import Link from 'next/link';
import type { QueryResult } from '@/lib/cache/lookup';

interface Props {
  result: QueryResult;
}

function formatCount(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '–';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return '–';
  return new Date(d).toISOString().slice(0, 10);
}

function pickMeta(meta: unknown, key: string): unknown {
  if (typeof meta !== 'object' || meta === null) return undefined;
  return (meta as Record<string, unknown>)[key];
}

/**
 * Renders one query result. Three branches:
 * - 'ok' → rich metadata card (description, stars, forks, language, link)
 * - 'not_found' → muted message + suggested /repo link
 * - 'error' → red message; if stale:true is set, still show the row with a
 *   "data may be delayed" warning banner (M8.2)
 */
export function LookupResultCard({ result }: Props) {
  if (result.fetch_status === 'not_found') {
    return (
      <div className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
        {result.canonical}: {result.error}
      </div>
    );
  }
  // ResultOk is the only branch with `stale` discriminator; narrow on it.
  if (!('stale' in result)) {
    return (
      <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
        {result.canonical}: {result.error}
      </div>
    );
  }
  const meta = result.metadata;
  const description = pickMeta(meta, 'description');
  const stars = pickMeta(meta, 'stargazers_count');
  const forks = pickMeta(meta, 'forks_count');
  const language = pickMeta(meta, 'language');
  const defaultBranch = pickMeta(meta, 'default_branch');
  const htmlUrl = pickMeta(meta, 'html_url');
  const lastFetchedAt = result.last_fetched_at;

  return (
    <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4">
      {result.stale && (
        <div className="mb-3 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          ⚠ {result.warning}
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold text-gray-900">{result.canonical}</h3>
          {typeof description === 'string' && description.length > 0 && (
            <p className="mt-1 text-sm text-gray-700">{description}</p>
          )}
        </div>
        <Link
          href={`/repo/${encodeURIComponent(result.canonical.split('/')[0] ?? '')}/${encodeURIComponent(result.canonical.split('/')[1] ?? '')}`}
          className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          Details →
        </Link>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-gray-500">Stars</dt>
          <dd className="font-medium text-gray-900">{formatCount(stars)}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Forks</dt>
          <dd className="font-medium text-gray-900">{formatCount(forks)}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Language</dt>
          <dd className="font-medium text-gray-900">
            {typeof language === 'string' && language ? language : '–'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Default branch</dt>
          <dd className="font-medium text-gray-900">
            {typeof defaultBranch === 'string' && defaultBranch ? defaultBranch : '–'}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>
          Last fetched: <time dateTime={formatDate(lastFetchedAt)}>{formatDate(lastFetchedAt)}</time>
        </span>
        {typeof htmlUrl === 'string' && (
          <a
            href={htmlUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-blue-600 hover:text-blue-800"
          >
            View on GitHub ↗
          </a>
        )}
      </div>
    </div>
  );
}
