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
    <main className="mx-auto max-w-4xl px-4 py-12 sm:py-16">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          GitHub Metadata Cache
        </h1>
        <p className="mt-3 text-base text-gray-600 sm:text-lg">
          Submit an owner / repository, get fresh metadata in milliseconds.
          Backed by a managed cache — no GitHub rate-limit pressure on your side.
        </p>
      </header>

      <section aria-label="Look up a repository">
        <LookupForm />
      </section>

      <section aria-label="Recent lookups" className="mt-12">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Recent lookups</h2>
        <RecentLookupsList repos={recent} />
      </section>

      <footer className="mt-16 border-t border-gray-200 pt-6 text-center text-sm text-gray-500">
        <p>
          Need the raw API?{' '}
          <a
            href="/api/v1/status"
            className="font-medium text-blue-600 hover:text-blue-800"
          >
            /api/v1/status
          </a>{' '}
          for health ·{' '}
          <a href="/login" className="font-medium text-blue-600 hover:text-blue-800">
            admin login
          </a>
        </p>
      </footer>
    </main>
  );
}
