export default function RepoLoading() {
  return (
    <main>
      {/* Hero skeleton */}
      <section className="ghc-hero-gradient border-b border-slate-200/60">
        <div className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
          <div className="ghc-shimmer mb-6 h-4 w-32 rounded" />
          <div className="ghc-shimmer mb-3 h-9 w-3/4 rounded" />
          <div className="ghc-shimmer h-5 w-1/2 rounded" />
          <div className="mt-4 flex gap-2">
            <div className="ghc-shimmer h-6 w-16 rounded-full" />
            <div className="ghc-shimmer h-6 w-20 rounded-full" />
            <div className="ghc-shimmer h-6 w-14 rounded-full" />
          </div>
        </div>
      </section>

      {/* Stats skeleton */}
      <section className="mx-auto max-w-4xl px-4 py-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="ghc-stat">
              <div className="ghc-shimmer h-3 w-16 rounded" />
              <div className="ghc-shimmer mt-2 h-8 w-20 rounded" />
            </div>
          ))}
        </div>
      </section>

      {/* Cards skeleton */}
      <section className="mx-auto max-w-4xl px-4 pb-12">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="ghc-card p-5">
            <div className="ghc-shimmer mb-3 h-4 w-32 rounded" />
            <div className="space-y-2.5">
              <div className="ghc-shimmer h-4 w-full rounded" />
              <div className="ghc-shimmer h-4 w-3/4 rounded" />
              <div className="ghc-shimmer h-4 w-2/3 rounded" />
            </div>
          </div>
          <div className="ghc-card p-5">
            <div className="ghc-shimmer mb-3 h-4 w-32 rounded" />
            <div className="space-y-2.5">
              <div className="ghc-shimmer h-4 w-full rounded" />
              <div className="ghc-shimmer h-4 w-3/4 rounded" />
              <div className="ghc-shimmer h-4 w-2/3 rounded" />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
