import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { collectV1Status } from '@/lib/api-docs/v1-status';

/**
 * /status — public service health dashboard.
 *
 * Built on top of `collectV1Status()` (same data the JSON API exposes),
 * but rendered as a rich UI: large overall-state banner + 4 colored
 * cards (Database, Tokens, Queue, Repositories) + version strip. Each
 * field is a deep link to the raw /api/v1/status JSON for users who
 * want to inspect the wire format.
 *
 * The DB-down path renders a degraded card instead of failing the page,
 * so an outage still gives operators + visitors a clear "the service is
 * down" signal rather than a 500.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('status.meta');
  return { title: t('title'), description: t('description') };
}

export default async function StatusPage(): Promise<ReactElement> {
  const t = await getTranslations('status');
  const status = await collectV1Status();

  if (status === null) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 ghc-fade-up">
        <header className="mb-8">
          <p className="ghc-eyebrow">{t('eyebrow')}</p>
          <h1 className="mt-2 text-3xl font-semibold">{t('heading')}</h1>
          <p className="mt-2 ghc-text-muted">{t('subtitle')}</p>
        </header>
        <DegradedBanner tDegraded={t('degraded')} />
      </main>
    );
  }

  const allOk =
    status.db === 'up' &&
    !status.scheduler.paused &&
    status.tokens.active > 0 &&
    status.queue.failed < 5;
  const degraded = !allOk;
  const repoErrorPct =
    status.repositories.total > 0
      ? Math.round((status.repositories.error / status.repositories.total) * 100)
      : 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 ghc-fade-up">
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="ghc-eyebrow">{t('eyebrow')}</p>
          <h1 className="mt-2 text-3xl font-semibold">{t('heading')}</h1>
          <p className="mt-2 ghc-text-muted">{t('subtitle')}</p>
        </div>
        <a href="/api/v1/status" className="ghc-btn-secondary ghc-btn-sm">
          {t('rawJson')} →
        </a>
      </header>

      {/* Overall state banner */}
      <section
        aria-label={t('overallAria')}
        className={`ghc-status-banner ${degraded ? 'ghc-status-banner-degraded' : 'ghc-status-banner-ok'}`}
      >
        <span
          className="ghc-status-dot"
          data-variant={degraded ? 'warn' : 'ok'}
          aria-hidden="true"
        />
        <div>
          <p className="ghc-status-banner-label">
            {degraded ? t('overallDegraded') : t('overallOk')}
          </p>
          <p className="ghc-status-banner-meta">
            {t('checkedAt', {
              time: new Date(status.timestamp).toLocaleString(),
            })}
          </p>
        </div>
      </section>

      {/* 4 status cards in a responsive grid */}
      <section
        aria-label={t('cardsAria')}
        className="mt-6 grid gap-4 sm:grid-cols-2"
      >
        <DatabaseCard t={t} status={status} />
        <SchedulerCard t={t} status={status} />
        <TokensCard t={t} status={status} />
        <QueueCard t={t} status={status} />
      </section>

      {/* Repositories card spans full width — more data + a small inline bar */}
      <section className="mt-4 ghc-card p-5" aria-label={t('reposAria')}>
        <header className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{t('repos.heading')}</h2>
          <span className="text-sm ghc-text-muted">
            {t('repos.total', { count: status.repositories.total })}
          </span>
        </header>
        <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-ink)_8%,transparent)]">
          <RepoBarSegment
            variant="ok"
            count={status.repositories.ok}
            total={status.repositories.total}
          />
          <RepoBarSegment
            variant="not_found"
            count={status.repositories.not_found}
            total={status.repositories.total}
          />
          <RepoBarSegment
            variant="forbidden"
            count={status.repositories.forbidden}
            total={status.repositories.total}
          />
          <RepoBarSegment
            variant="error"
            count={status.repositories.error}
            total={status.repositories.total}
          />
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <RepoLegend
            variant="ok"
            label={t('repos.ok')}
            count={status.repositories.ok}
          />
          <RepoLegend
            variant="not_found"
            label={t('repos.notFound')}
            count={status.repositories.not_found}
          />
          <RepoLegend
            variant="forbidden"
            label={t('repos.forbidden')}
            count={status.repositories.forbidden}
          />
          <RepoLegend
            variant="error"
            label={t('repos.error', { pct: repoErrorPct })}
            count={status.repositories.error}
          />
        </ul>
      </section>

      {/* Footer with version + tip */}
      <footer className="mt-8 grid gap-3 sm:grid-cols-2 text-sm ghc-text-muted">
        <p>
          {t('version.commit', { commit: status.version.commit })}
          <br />
          {t('version.startedAt', { time: new Date(status.version.startedAt).toLocaleString() })}
        </p>
        <p>
          {t('version.node', { node: status.version.nodeVersion })}
          <br />
          {t('version.refresh', { seconds: 5 })}
        </p>
      </footer>
    </main>
  );
}

function DegradedBanner({ tDegraded }: { tDegraded: string }): ReactElement {
  return (
    <div className="ghc-alert-danger" role="alert">
      <p className="font-semibold">{tDegraded}</p>
    </div>
  );
}

function DatabaseCard({
  t,
  status,
}: {
  t: Awaited<ReturnType<typeof getTranslations>>;
  status: NonNullable<Awaited<ReturnType<typeof collectV1Status>>>;
}): ReactElement {
  const up = status.db === 'up';
  return (
    <article className="ghc-card p-5">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('db.heading')}</h2>
        <span className="ghc-chip-status" data-variant={up ? 'ok' : 'danger'}>
          {up ? t('db.up') : t('db.down')}
        </span>
      </header>
      <p className="mt-2 text-sm ghc-text-muted">{t('db.body')}</p>
    </article>
  );
}

function SchedulerCard({
  t,
  status,
}: {
  t: Awaited<ReturnType<typeof getTranslations>>;
  status: NonNullable<Awaited<ReturnType<typeof collectV1Status>>>;
}): ReactElement {
  const paused = status.scheduler.paused;
  return (
    <article className="ghc-card p-5">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('scheduler.heading')}</h2>
        <span className="ghc-chip-status" data-variant={paused ? 'warn' : 'ok'}>
          {paused ? t('scheduler.paused') : t('scheduler.running')}
        </span>
      </header>
      <p className="mt-2 text-sm ghc-text-muted">
        {paused ? t('scheduler.pausedBody') : t('scheduler.runningBody')}
      </p>
    </article>
  );
}

function TokensCard({
  t,
  status,
}: {
  t: Awaited<ReturnType<typeof getTranslations>>;
  status: NonNullable<Awaited<ReturnType<typeof collectV1Status>>>;
}): ReactElement {
  const noTokens = status.tokens.active === 0;
  return (
    <article className="ghc-card p-5">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('tokens.heading')}</h2>
        <span
          className="ghc-chip-status"
          data-variant={noTokens ? 'danger' : status.tokens.exhausted > 0 ? 'warn' : 'ok'}
        >
          {t('tokens.active', { count: status.tokens.active })}
        </span>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Stat label={t('tokens.exhausted')} value={String(status.tokens.exhausted)} />
        <Stat label={t('tokens.total')} value={String(status.tokens.total)} />
      </dl>
      <p className="mt-3 text-xs ghc-text-muted">{t('tokens.source')}</p>
    </article>
  );
}

function QueueCard({
  t,
  status,
}: {
  t: Awaited<ReturnType<typeof getTranslations>>;
  status: NonNullable<Awaited<ReturnType<typeof collectV1Status>>>;
}): ReactElement {
  const stuck = status.queue.pending > 0 && status.queue.in_progress === 0 && !status.scheduler.paused;
  return (
    <article className="ghc-card p-5">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('queue.heading')}</h2>
        <span
          className="ghc-chip-status"
          data-variant={stuck ? 'warn' : 'ok'}
        >
          {t('queue.pending', { count: status.queue.pending })}
        </span>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Stat label={t('queue.inProgress')} value={String(status.queue.in_progress)} />
        <Stat label={t('queue.failed')} value={String(status.queue.failed)} />
        <Stat label={t('queue.done24h')} value={String(status.queue.done)} />
        <Stat label={t('queue.empty')} value={status.queue.pending === 0 ? '✓' : '—'} />
      </dl>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide ghc-text-muted">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

function RepoBarSegment({
  variant,
  count,
  total,
}: {
  variant: 'ok' | 'not_found' | 'forbidden' | 'error';
  count: number;
  total: number;
}): ReactElement | null {
  if (count === 0 || total === 0) return null;
  const pct = (count / total) * 100;
  return (
    <div
      className="h-full"
      style={{
        width: `${pct}%`,
        background: `var(--color-${variant === 'not_found' ? 'ink-muted' : variant === 'forbidden' ? 'warn' : variant}, color-mix(in srgb, var(--color-${variant === 'not_found' ? 'ink-muted' : variant === 'forbidden' ? 'warn' : variant}) ${variant === 'ok' ? '70' : '40'}%, transparent)`,
      }}
      title={`${variant}: ${count}`}
    />
  );
}

function RepoLegend({
  variant,
  label,
  count,
}: {
  variant: 'ok' | 'not_found' | 'forbidden' | 'error';
  label: string;
  count: number;
}): ReactElement {
  return (
    <li className="flex items-center gap-2">
      <span
        className="ghc-chip-status"
        data-variant={
          variant === 'ok'
            ? 'ok'
            : variant === 'forbidden'
            ? 'warn'
            : variant === 'error'
            ? 'danger'
            : 'neutral'
        }
      >
        {count}
      </span>
      <span>{label}</span>
    </li>
  );
}
