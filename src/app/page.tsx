import type { Metadata } from 'next';
import { recentLookups } from '@/lib/db/repositories';
import { LookupForm } from './_components/lookup-form';
import { RecentLookupsList } from './_components/recent-lookups-list';
import { StatsBar } from './_components/stats-bar';
import { FeaturesSection } from './_components/features-section';
import { HowItWorks } from './_components/how-it-works';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'GitHub Metadata Cache',
  description:
    'Look up GitHub repository metadata — stars, forks, language, and more — instantly from a managed cache.',
};

export default async function HomePage() {
  const recent = await recentLookups(8);
  return (
    <main>
      {/* Hero */}
      <section className="ghc-hero-gradient">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:py-20">
          <div className="ghc-eyebrow mb-4 inline-flex items-center gap-2 px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
            Managed cache · per-IP rate-limited · open API
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            GitHub Metadata Cache
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-[color:var(--color-ink-muted)] sm:text-lg">
            Submit an owner / repository, get fresh metadata in milliseconds.
            Backed by a managed cache — no GitHub rate-limit pressure on your side.
          </p>
        </div>
      </section>

      {/* Lookup form */}
      <section className="mx-auto -mt-8 max-w-3xl px-4">
        <LookupForm />
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

      {/* Recent lookups */}
      <section className="mx-auto mt-16 max-w-6xl px-4 pb-16">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Recent lookups</h2>
          <span className="text-sm text-[color:var(--color-ink-muted)]">
            {recent.length} cached
          </span>
        </div>
        <RecentLookupsList repos={recent} />
      </section>

      {/* Footer */}
      <footer className="border-t border-[color:var(--color-rule)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-[color:var(--color-ink-muted)]">
          <p>
            Need the raw API?{' '}
            <a href="/api/v1/status" className="ghc-link">
              /api/v1/status
            </a>{' '}
            for health.
          </p>
          <p>
            <a href="/login" className="ghc-link">
              Admin login →
            </a>
          </p>
        </div>
      </footer>
    </main>
  );
}