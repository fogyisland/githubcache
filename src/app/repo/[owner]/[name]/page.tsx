import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { lookupRepo, type QueryResult } from '@/lib/cache/lookup';

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

function pickMeta(meta: unknown, key: string): unknown {
  if (typeof meta !== 'object' || meta === null) return undefined;
  return (meta as Record<string, unknown>)[key];
}

function formatCount(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '–';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDate(d: unknown): string {
  if (typeof d !== 'string') return '–';
  const t = Date.parse(d);
  if (Number.isNaN(t)) return '–';
  return new Date(t).toISOString().slice(0, 10);
}

function formatTopics(meta: unknown): string[] {
  const topics = pickMeta(meta, 'topics');
  if (!Array.isArray(topics)) return [];
  return topics.filter((t): t is string => typeof t === 'string');
}

function RepoOkView({ result }: { result: Extract<QueryResult, { fetch_status: 'ok' }> }) {
  const meta = result.metadata;
  const description = pickMeta(meta, 'description');
  const stars = pickMeta(meta, 'stargazers_count');
  const forks = pickMeta(meta, 'forks_count');
  const watchers = pickMeta(meta, 'subscribers_count');
  const openIssues = pickMeta(meta, 'open_issues_count');
  const language = pickMeta(meta, 'language');
  const defaultBranch = pickMeta(meta, 'default_branch');
  const htmlUrl = pickMeta(meta, 'html_url');
  const homepage = pickMeta(meta, 'homepage');
  const topics = formatTopics(meta);
  const licenseName = pickMeta(pickMeta(meta, 'license'), 'spdx_id') ?? pickMeta(pickMeta(meta, 'license'), 'name');
  const createdAt = pickMeta(meta, 'created_at');
  const updatedAt = pickMeta(meta, 'updated_at');
  const pushedAt = pickMeta(meta, 'pushed_at');
  const size = pickMeta(meta, 'size');

  return (
    <article>
      <header className="border-b border-gray-200 pb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-mono text-2xl font-bold text-gray-900 sm:text-3xl">
            {result.canonical}
          </h1>
          {typeof htmlUrl === 'string' && (
            <a
              href={htmlUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm font-medium text-blue-600 hover:text-blue-800"
            >
              View on GitHub ↗
            </a>
          )}
        </div>
        {result.stale && result.warning && (
          <div className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ⚠ {result.warning}
          </div>
        )}
        {typeof description === 'string' && description.length > 0 && (
          <p className="mt-3 text-gray-700">{description}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {typeof language === 'string' && language && (
            <span className="rounded bg-blue-50 px-2 py-1 font-medium text-blue-800">{language}</span>
          )}
          {typeof licenseName === 'string' && licenseName && (
            <span className="rounded bg-gray-100 px-2 py-1 text-gray-700">{licenseName}</span>
          )}
          {topics.map((t) => (
            <span key={t} className="rounded bg-gray-100 px-2 py-1 text-gray-700">
              {t}
            </span>
          ))}
        </div>
      </header>

      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Stars" value={formatCount(stars)} />
        <Stat label="Forks" value={formatCount(forks)} />
        <Stat label="Watchers" value={formatCount(watchers)} />
        <Stat label="Open issues" value={formatCount(openIssues)} />
      </dl>

      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Repository</h2>
          <dl className="mt-2 space-y-2 text-sm">
            <Row label="Default branch" value={typeof defaultBranch === 'string' ? defaultBranch : '–'} />
            {typeof homepage === 'string' && homepage && (
              <Row
                label="Homepage"
                value={
                  <a
                    href={homepage}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-blue-600 hover:text-blue-800"
                  >
                    {homepage}
                  </a>
                }
              />
            )}
            <Row label="Size" value={typeof size === 'number' ? `${size.toLocaleString()} KB` : '–'} />
          </dl>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Activity</h2>
          <dl className="mt-2 space-y-2 text-sm">
            <Row label="Created" value={formatDate(createdAt)} />
            <Row label="Updated" value={formatDate(updatedAt)} />
            <Row label="Last push" value={formatDate(pushedAt)} />
          </dl>
        </div>
      </section>

      <footer className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-500">
        <p>
          Last fetched:{' '}
          <time dateTime={result.last_fetched_at?.toISOString() ?? ''}>
            {result.last_fetched_at?.toISOString().slice(0, 10) ?? '–'}
          </time>{' · '}
          <Link href="/" className="text-blue-600 hover:text-blue-800">
            ← back to home
          </Link>
        </p>
      </footer>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-gray-900">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{value}</dd>
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
    // fetch_status === 'error'
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="font-mono text-2xl font-bold text-gray-900">
          {result.canonical}
        </h1>
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {result.error}
        </p>
        <p className="mt-4 text-sm text-gray-500">
          <Link href="/" className="text-blue-600 hover:text-blue-800">
            ← back to home
          </Link>
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <RepoOkView result={result} />
    </main>
  );
}
