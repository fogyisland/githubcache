'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { QueryResult } from '@/lib/cache/lookup';
import {
  formatCount,
  formatDate,
  getDefaultBranch,
  getDescription,
  getForks,
  getHtmlUrl,
  getLanguage,
  getStars,
} from '@/lib/repo/metadata';

interface Props {
  result: QueryResult;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
      aria-label={`Copy ${text}`}
    >
      {copied ? (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5 text-green-600"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
              clipRule="evenodd"
            />
          </svg>
          <span>Copied</span>
        </>
      ) : (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M7 3.5A1.5 1.5 0 018.5 2h3A1.5 1.5 0 0113 3.5v.5h.75A1.5 1.5 0 0115.25 5.5v9A1.5 1.5 0 0113.75 16h-7.5A1.5 1.5 0 014.75 14.5v-9A1.5 1.5 0 016.25 4H7v-.5zM6.25 5.5a.25.25 0 00-.25.25v9c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-9a.25.25 0 00-.25-.25H13v.5A1.5 1.5 0 0111.5 7h-3A1.5 1.5 0 017 5.5v-.5h-.75z" />
          </svg>
          <span>Copy</span>
        </>
      )}
    </button>
  );
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
      <div className="ghc-fade-up mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <span className="font-mono font-semibold">{result.canonical}</span> — {result.error}
      </div>
    );
  }
  // ResultOk is the only branch with `stale` discriminator; narrow on it.
  if (!('stale' in result)) {
    return (
      <div className="ghc-fade-up mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <span className="font-mono font-semibold">{result.canonical}</span> — {result.error}
      </div>
    );
  }
  const meta = result.metadata;
  const description = getDescription(meta);
  const stars = getStars(meta);
  const forks = getForks(meta);
  const language = getLanguage(meta);
  const defaultBranch = getDefaultBranch(meta);
  const lastFetchedAt = result.last_fetched_at;
  const [owner, repoName] = result.canonical.split('/');
  const ownerDecoded = decodeURIComponent(owner ?? '');
  const repoNameDecoded = decodeURIComponent(repoName ?? '');
  const htmlUrl = getHtmlUrl(ownerDecoded, repoNameDecoded);

  return (
    <div className="ghc-fade-up mt-5 overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-sm">
      {result.stale && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          ⚠ {result.warning}
        </div>
      )}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-mono text-lg font-semibold text-slate-900">
                {result.canonical}
              </h3>
              <CopyButton text={result.canonical} />
            </div>
            {description && <p className="mt-1.5 text-sm text-slate-700">{description}</p>}
          </div>
          <a
            href={htmlUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="ghc-btn-ghost shrink-0"
            aria-label="View on GitHub"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="mr-1.5 h-4 w-4"
              aria-hidden="true"
            >
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            GitHub
          </a>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Stars" value={formatCount(stars)} icon="★" />
          <Stat label="Forks" value={formatCount(forks)} icon="⑂" />
          <Stat label="Language" value={language ?? '–'} />
          <Stat label="Default branch" value={defaultBranch ?? '–'} />
        </dl>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 bg-white/60 px-5 py-2.5 text-xs text-slate-500">
        <span>
          Last fetched{' '}
          <time dateTime={formatDate(lastFetchedAt)} className="font-medium text-slate-700">
            {formatDate(lastFetchedAt)}
          </time>
        </span>
        <Link
          href={`/repo/${encodeURIComponent(ownerDecoded)}/${encodeURIComponent(repoNameDecoded)}`}
          className="ghc-link"
        >
          View details →
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        {icon && <span className="text-sm text-slate-400">{icon}</span>}
        <span className="font-semibold text-slate-900">{value}</span>
      </div>
    </div>
  );
}