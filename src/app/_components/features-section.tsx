import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

export async function FeaturesSection(): Promise<ReactElement> {
  const t = await getTranslations('home.features');
  const items = [
    { key: 'instant', icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    )},
    { key: 'cached', icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <ellipse cx="12" cy="5" rx="8" ry="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    )},
    { key: 'rateLimited', icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 10v4M11 10v4M15 10v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )},
  ] as const;

  return (
    <section className="ghc-features" data-testid="ghc-features-section">
      <div className="ghc-section-eyebrow">{t('eyebrow')}</div>
      <h2 className="ghc-section-heading">{t('heading')}</h2>
      <div className="ghc-features-grid">
        {items.map((item) => (
          <article key={item.key} className="ghc-feature-card">
            <div className="ghc-feature-icon">{item.icon}</div>
            <h3 className="ghc-feature-title">{t(`items.${item.key}.title`)}</h3>
            <p className="ghc-feature-demo">{t(`items.${item.key}.demo`)}</p>
            <p className="ghc-feature-body">{t(`items.${item.key}.body`)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
