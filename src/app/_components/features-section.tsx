import type { ReactElement } from 'react';

interface Feature {
  title: string;
  demo: string;
  body: string;
  icon: ReactElement;
}

const features: Feature[] = [
  {
    title: 'Instant',
    demo: '~12 ms median',
    body:
      'Most lookups come straight from the local DB — no roundtrip to GitHub, no rate-limit waiting.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'Cached',
    demo: 'metadata + node tree',
    body:
      'Stored as JSON in MySQL — the same payload you would have built from the GitHub REST API.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <ellipse cx="12" cy="5" rx="8" ry="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    title: 'Rate-limited + API',
    demo: '60 req/min · 10k/day',
    body:
      'Per-key quotas protect the cache. A clean REST endpoint mirrors the GitHub shape so existing clients work.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 10v4M11 10v4M15 10v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function FeaturesSection(): ReactElement {
  return (
    <section className="ghc-features" data-testid="ghc-features-section">
      <div className="ghc-section-eyebrow">What you get</div>
      <h2 className="ghc-section-heading">A cache that takes the load off GitHub.</h2>
      <div className="ghc-features-grid">
        {features.map((f) => (
          <article key={f.title} className="ghc-feature-card">
            <div className="ghc-feature-icon">{f.icon}</div>
            <h3 className="ghc-feature-title">{f.title}</h3>
            <p className="ghc-feature-demo">{f.demo}</p>
            <p className="ghc-feature-body">{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}