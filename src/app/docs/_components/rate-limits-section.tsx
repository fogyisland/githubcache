import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { env } from '@/lib/config/env';

/**
 * Three-tier rate-limit explainer rendered on the docs landing page.
 *
 * Source of truth for the displayed numbers:
 *   - PUBLIC_REPO_RATE_PER_HOUR  — env default 50_000 (per API key, hourly window)
 *   - apiKey.rateLimitPerMin      — Prisma @default(60)  (per API key, per minute)
 *   - apiKey.dailyQuota           — Prisma @default(10000) (per API key, per day)
 *
 * The previous M14.3 layout had a "public lookup" tier for /api/v1/repos
 * (30/min per IP, no auth). M26.x changed that endpoint to require X-API-Key
 * and bumped the limit to 50_000/hour per key. The new layout has:
 *
 *   Tier 1 — status      : public, no limit
 *   Tier 2 — single repo : authenticated (X-API-Key), 50 000 / hour / key
 *   Tier 3 — batch       : authenticated (X-API-Key), 60 / min / key + 10 000 / day / key
 */
export async function RateLimitsSection(): Promise<ReactElement> {
  const t = await getTranslations('docs.landing.rateLimits');
  const authRepoPerHour = env.PUBLIC_REPO_RATE_PER_HOUR;
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

        {/* Tier 2: Authenticated single-repo — per-key, per-hour. */}
        <article className="ghc-doc-ratelimit-card">
          <h3 className="ghc-doc-ratelimit-card-title">{t('tier.authRepo.title')}</h3>
          <p className="ghc-doc-ratelimit-card-endpoint">
            <code>{t('tier.authRepo.endpoint')}</code>
          </p>
          <p className="ghc-doc-ratelimit-card-per">
            {t('tier.authRepo.per', { limit: authRepoPerHour })}
          </p>
          <p className="ghc-doc-ratelimit-card-body">
            {t('tier.authRepo.body', { limit: authRepoPerHour })}
          </p>
          <p className="ghc-doc-ratelimit-card-headers">{t('tier.authRepo.headers')}</p>
        </article>

        {/* Tier 3: Authenticated batch — per-key per-minute + daily quota. */}
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
