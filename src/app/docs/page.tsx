import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { CurlExample } from './_components/curl-example';
import { RateLimitsSection } from './_components/rate-limits-section';
import { LiveStatusWidget } from './_components/live-status-widget';
import { DownloadSpecCard } from './_components/download-spec-card';
import { HowCachingWorks } from './_components/how-caching-works';
import { ErrorCodesTable } from './_components/error-codes-table';
import { ENDPOINT_DOCS } from '@/lib/api-docs/registry';

export default async function DocsLanding(): Promise<ReactElement> {
  const t = await getTranslations('docs.landing');
  // Pre-await async sub-components before embedding in JSX (Task 2 SiteFooter pattern).
  const curlExample = await CurlExample({ method: 'GET', url: 'https://githubcache.example.com/api/v1/status' });
  const rateLimits = await RateLimitsSection();
  const liveStatus = await LiveStatusWidget();
  const downloadSpec = await DownloadSpecCard({});
  const howCaching = await HowCachingWorks();
  const errorCodes = await ErrorCodesTable();
  return (
    <article className="ghc-doc-landing">
      <p className="ghc-section-eyebrow">{t('eyebrow')}</p>
      <h1 className="ghc-doc-h1">{t('title')}</h1>
      <p className="ghc-doc-lede">{t('lede')}</p>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('quickStart.heading')}</h2>
        <p>{t('quickStart.body')}</p>
        {curlExample}
      </section>

      {howCaching}

      {/* Overview card grid — six sections, three columns on desktop.
          Each card deep-links into the corresponding section. */}
      <section className="ghc-doc-section" aria-label={t('overviewCards.heading')}>
        <h2 className="ghc-doc-h2">{t('overviewCards.heading')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <OverviewCard
            href="#endpoints"
            title={t('overviewCards.endpointsTitle')}
            body={t('overviewCards.endpointsBody')}
          />
          <OverviewCard
            href="#howCaching"
            title={t('overviewCards.howCachingTitle')}
            body={t('overviewCards.howCachingBody')}
          />
          <OverviewCard
            href="#rateLimits"
            title={t('overviewCards.rateLimitsTitle')}
            body={t('overviewCards.rateLimitsBody')}
          />
          <OverviewCard
            href="#errorCodes"
            title={t('overviewCards.errorCodesTitle')}
            body={t('overviewCards.errorCodesBody')}
          />
          <OverviewCard
            href="/docs/development"
            title={t('overviewCards.developmentTitle')}
            body={t('overviewCards.developmentBody')}
          />
          <OverviewCard
            href="/docs/deployment"
            title={t('overviewCards.deploymentTitle')}
            body={t('overviewCards.deploymentBody')}
          />
        </div>
      </section>

      <section id="endpoints" className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('endpoints.heading')}</h2>
        <ul className="ghc-doc-endpoint-list">
          {ENDPOINT_DOCS.map((doc) => (
            <li key={doc.slug} className="ghc-doc-endpoint-list-item">
              <a href={`/docs/${doc.slug}`}>
                <span className={`ghc-doc-method ghc-doc-method-${doc.method}`}>{doc.method}</span>
                <code>{doc.path}</code>
              </a>
              <p className="ghc-doc-endpoint-summary">{doc.summary}</p>
            </li>
          ))}
        </ul>
        <p>
          <a href="/docs/development">{t('developmentLink')}</a>
          {' — '}{t('developmentLinkBody')}
        </p>
      </section>

      {downloadSpec}
      {errorCodes}
      {rateLimits}
      {liveStatus}
    </article>
  );
}

function OverviewCard({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}): ReactElement {
  return (
    <a href={href} className="ghc-card p-5 hover:bg-[color-mix(in_srgb,var(--color-accent-soft)_60%,var(--color-surface))] transition-colors">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm ghc-text-muted">{body}</p>
    </a>
  );
}
