import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { CurlExample } from './_components/curl-example';
import { ENDPOINT_DOCS } from '@/lib/api-docs/registry';

export default async function DocsLanding(): Promise<ReactElement> {
  const t = await getTranslations('docs.landing');
  // Pre-await async sub-component before embedding in JSX (Task 2 SiteFooter pattern).
  const curlExample = await CurlExample({ method: 'GET', url: 'https://githubcache.example.com/api/v1/status' });
  return (
    <article className="ghc-doc-landing">
      <p className="ghc-section-eyebrow">{t('eyebrow')}</p>
      <h1 className="ghc-doc-h1">{t('title')}</h1>
      <p className="ghc-doc-lede">{t('lede')}</p>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('quickStart.heading')}</h2>
        <p>{t('quickStart.body')}</p>
        {curlExample}
      </section>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('endpoints.heading')}</h2>
        <ul className="ghc-doc-endpoint-list">
          {ENDPOINT_DOCS.map((doc) => (
            <li key={doc.slug} className="ghc-doc-endpoint-list-item">
              <a href={`/docs/${doc.slug}`}>
                <span className={`ghc-doc-method ghc-doc-method-${doc.method}`}>{doc.method}</span>
                <code>{doc.path}</code>
              </a>
              <p className="ghc-doc-endpoint-summary">{doc.summary}</p>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
