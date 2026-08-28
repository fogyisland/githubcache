import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

export async function HowItWorks(): Promise<ReactElement> {
  const t = await getTranslations('home.howItWorks');
  const steps = [
    { number: '01', key: 'submit', diagram: (
      <svg viewBox="0 0 200 80" width="100%" height="80" aria-hidden="true">
        <rect x="4" y="14" width="120" height="52" rx="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <text x="14" y="34" fontFamily="ui-monospace, monospace" fontSize="11" fill="currentColor">torvalds</text>
        <line x1="14" y1="42" x2="116" y2="42" stroke="currentColor" strokeWidth="0.6" />
        <text x="14" y="58" fontFamily="ui-monospace, monospace" fontSize="11" fill="currentColor">linux</text>
        <path d="M128 40 L160 40" stroke="currentColor" strokeWidth="1.2" />
        <path d="M156 36 L160 40 L156 44" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <rect x="164" y="28" width="32" height="24" rx="3" fill="currentColor" opacity="0.18" />
      </svg>
    )},
    { number: '02', key: 'cacheOrFetch', diagram: (
      <svg viewBox="0 0 200 80" width="100%" height="80" aria-hidden="true">
        <ellipse cx="100" cy="40" rx="78" ry="22" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <text x="56" y="44" fontFamily="ui-monospace, monospace" fontSize="11" fill="currentColor">cache</text>
        <text x="118" y="44" fontFamily="ui-monospace, monospace" fontSize="11" fill="currentColor">GitHub</text>
        <line x1="22" y1="40" x2="36" y2="40" stroke="currentColor" strokeWidth="1.2" />
        <line x1="164" y1="40" x2="178" y2="40" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )},
    { number: '03', key: 'json', diagram: (
      <svg viewBox="0 0 200 80" width="100%" height="80" aria-hidden="true">
        <rect x="4" y="8" width="192" height="64" rx="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <text x="12" y="24" fontFamily="ui-monospace, monospace" fontSize="10" fill="currentColor">"id": 2325298,</text>
        <text x="12" y="38" fontFamily="ui-monospace, monospace" fontSize="10" fill="currentColor">"stargazers_count": 172900,</text>
        <text x="12" y="52" fontFamily="ui-monospace, monospace" fontSize="10" fill="currentColor">"language": "C",</text>
        <text x="12" y="66" fontFamily="ui-monospace, monospace" fontSize="10" fill="currentColor">"node": { '{ ... }' }</text>
      </svg>
    )},
  ] as const;

  return (
    <section className="ghc-how-it-works" data-testid="ghc-how-it-works">
      <div className="ghc-section-eyebrow">{t('eyebrow')}</div>
      <h2 className="ghc-section-heading">{t('heading')}</h2>
      <ol className="ghc-how-steps">
        {steps.map((s) => (
          <li key={s.number} className="ghc-how-step">
            <div className="ghc-how-step-number">{s.number}</div>
            <h3 className="ghc-how-step-title">{t(`steps.${s.key}.title`)}</h3>
            <p className="ghc-how-step-body">{t(`steps.${s.key}.body`)}</p>
            <div className="ghc-how-step-diagram">{s.diagram}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
