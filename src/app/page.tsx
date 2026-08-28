import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { recentLookups } from '@/lib/db/repositories';
import { LookupForm } from './_components/lookup-form';
import { RecentLookupsList } from './_components/recent-lookups-list';
import { StatsBar } from './_components/stats-bar';
import { FeaturesSection } from './_components/features-section';
import { HowItWorks } from './_components/how-it-works';
import { ApiDocSection } from './_components/api-doc-section';
import { QuickTry } from './_components/quick-try';
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
  // in JSX so non-RSC renderers (e.g. vitest's renderToStaticMarkup) can
  // resolve it. Next.js handles this natively in production; the explicit
  // await is only needed for the test path.
  const footer = await SiteFooter();
  return (
    <main>
      {/* Hero */}
      <section className="ghc-hero-gradient">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:py-20">
          <div className="ghc-eyebrow mb-4 inline-flex items-center gap-2 px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
            {t('hero.eyebrow')}
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            {t('hero.title')}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-[color:var(--color-ink-muted)] sm:text-lg">
            {t('hero.tagline')}
          </p>
        </div>
      </section>

      {/* Lookup form */}
      <section className="mx-auto -mt-8 max-w-3xl px-4">
        <LookupForm />
      </section>

      {/* Quick try — 3 sample repo buttons that fire the lookup action. */}
      <section className="mx-auto mt-12 max-w-6xl px-4">
        <QuickTry />
      </section>

      {/* Stats bar — live counts from /api/v1/status, animated on mount. */}
      <section className="mx-auto mt-12 max-w-6xl px-4">
        <StatsBar />
      </section>

      {/* Features — 3-up grid (Instant / Cached / Rate-limited + API). */}
      <section className="mx-auto mt-16 max-w-6xl px-4">
        <FeaturesSection />
      </section>

      {/* How it works — 3 numbered steps with inline SVG diagrams. */}
      <section className="mx-auto mt-16 max-w-6xl px-4">
        <HowItWorks />
      </section>

      {/* API doc — curl example + trimmed response shape. */}
      <section className="mx-auto mt-16 max-w-6xl px-4">
        <ApiDocSection />
      </section>

      {/* Recent lookups */}
      <section className="mx-auto mt-16 max-w-6xl px-4 pb-16">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight">{t('recent.heading')}</h2>
          <span className="text-sm text-[color:var(--color-ink-muted)]">
            {t('recent.countCached', { count: recent.length })}
          </span>
        </div>
        <RecentLookupsList repos={recent} />
      </section>

      {/* Footer */}
      {footer}
    </main>
  );
}
