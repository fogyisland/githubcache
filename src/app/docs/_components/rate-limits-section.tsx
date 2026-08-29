import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { env } from '@/lib/config/env';

/**
 * Three-tier rate-limit explainer rendered on the docs landing page (M14.3).
 *
 * Source of truth for the displayed numbers:
 *   - PUBLIC_LOOKUP_RATE_PER_MIN — env default 30 (per IP)
 *   - apiKey.rateLimitPerMin     — Prisma @default(60)
 *   - apiKey.dailyQuota          — Prisma @default(10000)
 *
 * We intentionally surface the *defaults* from both config layers so
 * operators can see what the public contract is without reading the schema.
 */
export async function RateLimitsSection(): Promise<ReactElement> {
  const t = await getTranslations('docs.landing.rateLimits');
  const publicPerMin = env.PUBLIC_LOOKUP_RATE_PER_MIN;
  const apiKeyPerMin = 60; // mirrors apiKey.rateLimitPerMin @default
  return (
    <section className="ghc-doc-section" aria-labelledby="ghc-doc-rate-limits-heading">
      <h2 className="ghc-doc-h2" id="ghc-doc-rate-limits-heading">
        {t('heading')}
      </h2>
      <p>{t('intro')}</p>
      <div className="ghc-doc-ratelimit-grid">
        {/* Tier 1: Public status — no limit */}
        <article className="ghc-doc-ratelimit-card">
          <h3 className="ghc-doc-ratelimit-card-title">{t('tier.status.title')}</h3>
          <p className="ghc-doc-ratelimit-card-endpoint">
            <code>{t('tier.status.endpoint')}</code>
          </p>
          <p className="ghc-doc-ratelimit-card-per">{t('tier.status.per')}</p>
          <p className="ghc-doc-ratelimit-card-body">{t('tier.status.body')}</p>
        </article>

        {/* Tier 2: Public lookup — per-IP */}
        <article className="ghc-doc-ratelimit-card">
          <h3 className="ghc-doc-ratelimit-card-title">{t('tier.public.title')}</h3>
          <p className="ghc-doc-ratelimit-card-endpoint">
            <code>{t('tier.public.endpoint')}</code>
          </p>
          <p className="ghc-doc-ratelimit-card-per">
            {t('tier.public.per', { limit: publicPerMin })}
          </p>
          <p className="ghc-doc-ratelimit-card-body">
            {t('tier.public.body', { limit: publicPerMin })}
          </p>
          <p className="ghc-doc-ratelimit-card-headers">{t('tier.public.headers')}</p>
        </article>

        {/* Tier 3: Authenticated batch — per-API-key */}
        <article className="ghc-doc-ratelimit-card">
          <h3 className="ghc-doc-ratelimit-card-title">{t('tier.auth.title')}</h3>
          <p className="ghc-doc-ratelimit-card-endpoint">
            <code>{t('tier.auth.endpoint')}</code>
          </p>
          <p className="ghc-doc-ratelimit-card-per">
            {t('tier.auth.per', { limit: apiKeyPerMin })}
          </p>
          <p className="ghc-doc-ratelimit-card-body">
            {t('tier.auth.body', { limit: apiKeyPerMin })}
          </p>
          <p className="ghc-doc-ratelimit-card-headers">{t('tier.auth.headers')}</p>
        </article>
      </div>
    </section>
  );
}
