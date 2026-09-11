import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { recentLookups } from '@/lib/db/repositories';
import { HeroSection } from './_components/hero-section';
import { StatsBar } from './_components/stats-bar';
import { FeaturesSection } from './_components/features-section';
import { ApiSplit } from './_components/api-split';
import { RecentLookupsList } from './_components/recent-lookups-list';
import { SiteFooter } from './_components/site-footer';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('home.meta');
  return {
    title: t('title'),
    description: t('description'),
  };
}

export default async function HomePage() {
  const t = await getTranslations('home');
  const recent = await recentLookups(8);
  // SiteFooter is async (uses getTranslations) — await it before embedding
  // in JSX so non-RSC renderers can resolve it.
  const footer = await SiteFooter();
  return (
    <main>
      {/* Hero — eyebrow + h1 + tagline + lookup form + quick-try */}
      <HeroSection />

      {/* Stats strip — live counts from /api/v1/status */}
      <section className="ghc-section">
        <div className="mx-auto max-w-6xl px-4">
          <StatsBar />
        </div>
      </section>

      {/* Features — 3-up grid */}
      <section className="ghc-section">
        <div className="mx-auto max-w-6xl px-4">
          <FeaturesSection />
        </div>
      </section>

      {/* API preview — split panel */}
      <section className="ghc-section">
        <div className="mx-auto max-w-6xl px-4">
          <ApiSplit />
        </div>
      </section>

      {/* Recent lookups */}
      <section className="ghc-section ghc-section-last">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="text-xl font-semibold tracking-tight">{t('recent.heading')}</h2>
            <span className="text-sm text-[color:var(--color-ink-muted)]">
              {t('recent.countCached', { count: recent.length })}
            </span>
          </div>
          <RecentLookupsList repos={recent} />
        </div>
      </section>

      {/* Footer */}
      {footer}
    </main>
  );
}