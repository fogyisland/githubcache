import Link from 'next/link';

export default function RepoNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-20 text-center">
      <div className="ghc-fade-up">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="mx-auto h-16 w-16 text-[color:var(--color-ink-muted)]"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
          />
        </svg>
        <h1 className="ghc-display-name mt-6">Repository not found</h1>
        <p className="mt-3 text-[color:var(--color-ink-muted)]">
          That repo doesn&apos;t exist on GitHub (or is private and not accessible).
        </p>
        <div className="mt-8">
          <Link href="/" className="ghc-btn-primary">
            ← Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}