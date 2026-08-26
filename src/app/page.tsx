import type { Metadata } from 'next';
import { recentLookups } from '@/lib/db/repositories';
import { LookupForm } from './_components/lookup-form';
import { RecentLookupsList } from './_components/recent-lookups-list';

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
      <section className="ghc-hero-gradient border-b border-slate-200/60">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:py-20">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-200/60 bg-white/70 px-3 py-1 text-xs font-medium text-blue-700 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Managed cache · per-IP rate-limited · open API
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            GitHub Metadata Cache
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600 sm:text-lg">
            Submit an owner / repository, get fresh metadata in milliseconds.
            Backed by a managed cache — no GitHub rate-limit pressure on your side.
          </p>
        </div>
      </section>

      {/* Lookup form */}
      <section className="mx-auto -mt-8 max-w-3xl px-4">
        <LookupForm />
      </section>

      {/* Recent lookups */}
      <section className="mx-auto mt-16 max-w-6xl px-4 pb-16">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Recent lookups</h2>
          <span className="text-sm text-slate-500">{recent.length} cached</span>
        </div>
        <RecentLookupsList repos={recent} />
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-slate-500">
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
