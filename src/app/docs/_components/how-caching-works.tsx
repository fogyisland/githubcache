import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

/**
 * M15 — "How caching works" explainer for the /docs landing. Walks an
 * external integrator through the cache+scheduler pipeline so they
 * understand when they'll hit cache vs. wait on a refresh vs. see a
 * stale-on-down response.
 */
export async function HowCachingWorks(): Promise<ReactElement> {
  const t = await getTranslations('docs.landing.howCachingWorks');
  const steps: Array<{ key: string; text: string }> = [
    { key: 'step1', text: t('steps.step1') },
    { key: 'step2', text: t('steps.step2') },
    { key: 'step3', text: t('steps.step3') },
    { key: 'step4', text: t('steps.step4') },
    { key: 'step5', text: t('steps.step5') },
  ];
  return (
    <section className="ghc-doc-section">
      <h2 className="ghc-doc-h2">{t('heading')}</h2>
      <p>{t('intro')}</p>
      <ol className="ghc-doc-cache-steps">
        {steps.map((s, i) => (
          <li key={s.key}>
            <span className="ghc-doc-cache-step-num">{String(i + 1).padStart(2, '0')}</span>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}