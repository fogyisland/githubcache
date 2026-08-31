import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
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
import { ApiShape } from './_components/api-shape';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { owner: string; name: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const owner = decodeURIComponent(params.owner);
  const name = decodeURIComponent(params.name);
  const t = await getTranslations('repo.meta');
  return {
    title: t('title', { owner, name }),
    description: t('description', { owner, name }),
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

async function RepoOkView({
  result,
  owner,
  name,
}: {
  result: Extract<QueryResult, { fetch_status: 'ok' }>;
  owner: string;
  name: string;
}): Promise<ReactElement> {
  const t = await getTranslations('repo');
  const tRepo = await getTranslations('repo.repositoryCard');
  const tAct = await getTranslations('repo.activityCard');
  const tStat = await getTranslations('repo.stats');
  const tFoot = await getTranslations('repo.footer');

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
      <header className="ghc-hero-gradient">
        <div className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
          <div className="ghc-masthead mb-3">{t('hero.masthead')}</div>
          <nav className="mb-4 text-sm">
            <Link href="/" className="ghc-link">
              {t('hero.backToAll')}
            </Link>
          </nav>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="ghc-display-name">{result.canonical}</h1>
            <a
              href={htmlUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="ghc-btn-ghost"
            >
              <GitHubMarkIcon />
              {t('hero.viewOnGithub')}
            </a>
          </div>
          {result.stale && result.warning && (
            <div className="ghc-fade-up mt-4 inline-flex items-center gap-2 border border-[color:var(--color-warn)] px-3 py-2 text-sm text-[color:var(--color-warn)]">
              ⚠ {result.warning}
            </div>
          )}
          {description && (
            <p className="mt-3 max-w-3xl text-base text-[color:var(--color-ink-muted)]">
              {description}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            {language && (
              <span className="ghc-chip">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-accent)]" />
                {language}
              </span>
            )}
            {licenseName && <span className="ghc-chip">{licenseName}</span>}
            {archived && (
              <span className="ghc-chip border-[color:var(--color-warn)] text-[color:var(--color-warn)]">
                {t('hero.chipArchived')}
              </span>
            )}
            {disabled && (
              <span className="ghc-chip border-[color:var(--color-danger)] text-[color:var(--color-danger)]">
                {t('hero.chipDisabled')}
              </span>
            )}
            {topics.map((topic) => (
              <span key={topic} className="ghc-chip">
                {topic}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Stats grid */}
      <section className="mx-auto max-w-4xl px-4 py-8">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <Stat label={tStat('stars')} value={formatCount(stars)} />
          <Stat label={tStat('forks')} value={formatCount(forks)} />
          <Stat label={tStat('watchers')} value={formatCount(watchers)} />
        </dl>
      </section>

      {/* Detail cards */}
      <section className="mx-auto max-w-4xl px-4 pb-12">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="ghc-card p-5">
            <h2 className="mb-3 flex items-center gap-2 ghc-eyebrow">
              <MetaIcon d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
              {tRepo('heading')}
            </h2>
            <dl className="space-y-2.5 text-sm">
              <Row label={tRepo('defaultBranch')} value={defaultBranch ?? tRepo('dash')} />
              <Row label={tRepo('githubUrl')} value={htmlUrl} mono />
              {homepage && (
                <Row
                  label={tRepo('homepage')}
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
                label={tRepo('path')}
                value={`/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`}
                mono
              />
            </dl>
          </div>
          <div className="ghc-card p-5">
            <h2 className="mb-3 flex items-center gap-2 ghc-eyebrow">
              <MetaIcon d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              {tAct('heading')}
            </h2>
            <dl className="space-y-2.5 text-sm">
              <Row label={tAct('created')} value={formatDate(createdAt)} />
              <Row label={tAct('updated')} value={formatDate(updatedAt)} />
              <Row label={tAct('lastPush')} value={formatDate(pushedAt)} />
            </dl>
          </div>
        </div>
      </section>

      {/* Raw API shape — collapsible JSON dump of what /api/v1/repos/... returns. */}
      <section className="mx-auto max-w-4xl px-4 pb-12">
        {await ApiShape({ owner, name, metadata: meta })}
      </section>

      <footer className="border-t border-[color:var(--color-rule)]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-[color:var(--color-ink-muted)]">
          <span>
            {tFoot('lastFetched')}{' '}
            <time
              dateTime={result.last_fetched_at?.toISOString() ?? ''}
              className="font-medium text-[color:var(--color-ink)]"
            >
              {result.last_fetched_at?.toISOString().slice(0, 16).replace('T', ' ') ?? tFoot('dash')}
            </time>
          </span>
          <Link href="/" className="ghc-link">
            {tFoot('backToHome')}
          </Link>
        </div>
      </footer>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ghc-stat">
      <div className="ghc-eyebrow">{label}</div>
      <div className="ghc-stat-number mt-1">{value}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[color:var(--color-ink-muted)]">{label}</dt>
      <dd
        className={`text-right font-medium ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

export default async function RepoDetailPage({ params }: PageProps): Promise<ReactElement> {
  const owner = decodeURIComponent(params.owner);
  const name = decodeURIComponent(params.name);
  const tHero = await getTranslations('repo.hero');
  const result = await lookupRepo(owner, name);
  if (result.fetch_status === 'not_found') {
    notFound();
  }
  if (result.fetch_status === 'pending') {
    // M20: cache miss — repo was just enqueued for the scheduler. Show a
    // minimal pending page so the URL still resolves (instead of 404).
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <nav className="mb-4 text-sm">
          <Link href="/" className="ghc-link">
            {tHero('backToAll')}
          </Link>
        </nav>
        <h1 className="ghc-display-name text-2xl">{result.canonical}</h1>
        <p
          className="ghc-fade-up mt-4 border border-[color:var(--color-accent)] px-4 py-3 text-sm text-[color:var(--color-accent)]"
          role="status"
        >
          Enqueued for refresh at {result.queuedAt}; scheduled for{' '}
          {result.scheduledFor}. Reload in a moment.
        </p>
      </main>
    );
  }
  if (!('stale' in result)) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <nav className="mb-4 text-sm">
          <Link href="/" className="ghc-link">
            {tHero('backToAll')}
          </Link>
        </nav>
        <h1 className="ghc-display-name text-2xl">{result.canonical}</h1>
        <p
          className="ghc-fade-up mt-4 border border-[color:var(--color-danger)] px-4 py-3 text-sm text-[color:var(--color-danger)]"
          role="alert"
        >
          {result.error}
        </p>
      </main>
    );
  }
  // Pre-await async server components so non-RSC renderers (vitest's
  // renderToStaticMarkup) can resolve them. Next.js handles this natively
  // in production; the explicit await is only needed for the test path.
  const okView = await RepoOkView({ result, owner, name });
  return <main>{okView}</main>;
}
