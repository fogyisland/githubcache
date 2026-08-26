import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { lookupRepo, type QueryResult } from '@/lib/cache/lookup';
import {
  formatCount,
  formatDate,
  getArchived,
  getCreatedAt,
  getDefaultBranch,
  getDescription,
  getDisabled,
  getForks,
  getHomepage,
  getHtmlUrl,
  getLanguage,
  getLicenseName,
  getPushedAt,
  getStars,
  getTopics,
  getUpdatedAt,
  getWatchers,
} from '@/lib/repo/metadata';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { owner: string; name: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const owner = decodeURIComponent(params.owner);
  const name = decodeURIComponent(params.name);
  return {
    title: `${owner}/${name} · GitHub Metadata Cache`,
    description: `Cached metadata for the GitHub repository ${owner}/${name}.`,
  };
}

function MetaIcon({ d }: { d: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function GitHubMarkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="mr-1.5 h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function RepoOkView({
  result,
  owner,
  name,
}: {
  result: Extract<QueryResult, { fetch_status: 'ok' }>;
  owner: string;
  name: string;
}) {
  const meta = result.metadata;
  const description = getDescription(meta);
  const stars = getStars(meta);
  const forks = getForks(meta);
  const watchers = getWatchers(meta);
  const language = getLanguage(meta);
  const defaultBranch = getDefaultBranch(meta);
  const homepage = getHomepage(meta);
  const topics = getTopics(meta);
  const licenseName = getLicenseName(meta);
  const createdAt = getCreatedAt(meta);
  const updatedAt = getUpdatedAt(meta);
  const pushedAt = getPushedAt(meta);
  const archived = getArchived(meta);
  const disabled = getDisabled(meta);
  const htmlUrl = getHtmlUrl(owner, name);

  return (
    <article className="ghc-fade-up">
      {/* Hero */}
      <header className="ghc-hero-gradient border-b border-slate-200/60">
        <div className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
          <nav className="mb-4 text-sm text-slate-600">
            <Link href="/" className="hover:text-slate-900">
              ← All repositories
            </Link>
          </nav>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="font-mono text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              {result.canonical}
            </h1>
            <a
              href={htmlUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="ghc-btn-ghost border border-slate-200 bg-white/80 backdrop-blur"
            >
              <GitHubMarkIcon />
              View on GitHub
            </a>
          </div>
          {result.stale && result.warning && (
            <div className="ghc-fade-up mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              ⚠ {result.warning}
            </div>
          )}
          {description && <p className="mt-3 max-w-3xl text-base text-slate-700">{description}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            {language && (
              <span className="ghc-chip bg-blue-50 text-blue-700">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                {language}
              </span>
            )}
            {licenseName && (
              <span className="ghc-chip bg-slate-100 text-slate-700">{licenseName}</span>
            )}
            {archived && <span className="ghc-chip bg-amber-50 text-amber-700">Archived</span>}
            {disabled && <span className="ghc-chip bg-rose-50 text-rose-700">Disabled</span>}
            {topics.map((t) => (
              <span key={t} className="ghc-chip bg-violet-50 text-violet-700">
                {t}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Stats grid */}
      <section className="mx-auto max-w-4xl px-4 py-8">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          <Stat label="Stars" value={formatCount(stars)} accent="amber" />
          <Stat label="Forks" value={formatCount(forks)} accent="emerald" />
          <Stat label="Watchers" value={formatCount(watchers)} accent="violet" />
        </dl>
      </section>

      {/* Detail cards */}
      <section className="mx-auto max-w-4xl px-4 pb-12">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="ghc-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <MetaIcon d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
              Repository
            </h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <Row label="Default branch" value={defaultBranch ?? '–'} />
              <Row label="GitHub URL" value={htmlUrl} mono={false} />
              {homepage && (
                <Row
                  label="Homepage"
                  value={
                    <a
                      href={homepage}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ghc-link break-all"
                    >
                      {homepage}
                    </a>
                  }
                />
              )}
              <Row
                label="Path"
                value={`/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`}
                mono
              />
            </dl>
          </div>
          <div className="ghc-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <MetaIcon d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              Activity
            </h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <Row label="Created" value={formatDate(createdAt)} />
              <Row label="Updated" value={formatDate(updatedAt)} />
              <Row label="Last push" value={formatDate(pushedAt)} />
            </dl>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-slate-500">
          <span>
            Last fetched:{' '}
            <time
              dateTime={result.last_fetched_at?.toISOString() ?? ''}
              className="font-medium text-slate-700"
            >
              {result.last_fetched_at?.toISOString().slice(0, 16).replace('T', ' ') ?? '–'}
            </time>
          </span>
          <Link href="/" className="ghc-link">
            ← back to home
          </Link>
        </div>
      </footer>
    </article>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'amber' | 'emerald' | 'violet' | 'rose';
}) {
  const accentMap: Record<string, string> = {
    amber: 'text-amber-600',
    emerald: 'text-emerald-600',
    violet: 'text-violet-600',
    rose: 'text-rose-600',
  };
  return (
    <div className="ghc-stat">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 text-3xl font-bold ${accentMap[accent] ?? 'text-slate-900'}`}>{value}</dd>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right font-medium text-slate-900 ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

export default async function RepoDetailPage({ params }: PageProps) {
  const owner = decodeURIComponent(params.owner);
  const name = decodeURIComponent(params.name);
  const result = await lookupRepo(owner, name);
  if (result.fetch_status === 'not_found') {
    notFound();
  }
  if (!('stale' in result)) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <nav className="mb-4 text-sm text-slate-600">
          <Link href="/" className="hover:text-slate-900">
            ← All repositories
          </Link>
        </nav>
        <h1 className="font-mono text-2xl font-bold text-slate-900">{result.canonical}</h1>
        <p
          className="ghc-fade-up mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {result.error}
        </p>
      </main>
    );
  }
  return (
    <main>
      <RepoOkView result={result} owner={owner} name={name} />
    </main>
  );
}