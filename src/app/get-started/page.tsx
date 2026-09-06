import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CurlExample } from '@/app/docs/_components/curl-example';

/**
 * `/get-started` — public-facing walkthrough that takes a brand-new user
 * from "what is this" to "I just got a 200 response".
 *
 * Visual direction: Wulan-aligned step cards (light surface + sky-blue accent +
 * 6px radius + sans body). Mirrors the look of /docs and /docs/development.
 *
 *   - `.ghc-getstarted-step` wraps each step in a Wulan `.ghc-card`-style panel
 *   - `.ghc-getstarted-step-num` is a sky-blue pill showing the step number
 *   - `.ghc-getstarted-callout` is a left-bordered accent box for important
 *     callouts (the "token shown ONCE" warning, etc.)
 *   - Curl examples reuse the existing `CurlExample` component so copy-to-
 *     clipboard stays consistent with /docs
 */

const ERROR_ROWS = [
  { code: 'unauthorized', http: '401', meaningKey: 'step4.errors.unauthorized' },
  { code: 'forbidden', http: '403', meaningKey: 'step4.errors.forbidden' },
  { code: 'rate_limited', http: '429', meaningKey: 'step4.errors.rate_limited' },
  { code: 'not_found', http: '404', meaningKey: 'step4.errors.not_found' },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('getStarted.meta');
  return { title: t('title'), description: t('description') };
}

export default async function GetStartedPage(): Promise<ReactElement> {
  const t = await getTranslations('getStarted');

  const statusCurl = await CurlExample({
    method: 'GET',
    url: 'https://githubcache.example.com/api/v1/status',
  });
  const repoCurl = await CurlExample({
    method: 'GET',
    url: 'https://githubcache.example.com/api/v1/repos/facebook/react',
  });
  const batchCurl = await CurlExample({
    method: 'POST',
    url: 'https://githubcache.example.com/api/query',
    headers: { 'X-API-Key': 'YOUR_KEY_HERE' },
    body: { nodes: [{ owner: 'facebook', name: 'react' }] },
  });

  return (
    <article className="ghc-getstarted">
      <span className="ghc-getstarted-eyebrow">{t('eyebrow')}</span>
      <h1 className="ghc-getstarted-h1">{t('title')}</h1>
      <p className="ghc-getstarted-lede">{t('lede')}</p>

      {/* Step 1 — Ask an admin for an account */}
      <section className="ghc-getstarted-step">
        <div className="ghc-getstarted-step-header">
          <span className="ghc-getstarted-step-num">1</span>
          <h2>{t('step1.heading')}</h2>
        </div>
        <p>{t('step1.body')}</p>
        <div className="ghc-getstarted-callout">
          <span className="ghc-getstarted-callout-label">{t('step1.calloutLabel')}</span>
          <p>{t('step1.calloutBody')}</p>
        </div>
      </section>

      {/* Step 2 — Request an API key */}
      <section className="ghc-getstarted-step">
        <div className="ghc-getstarted-step-header">
          <span className="ghc-getstarted-step-num">2</span>
          <h2>{t('step2.heading')}</h2>
        </div>
        <p>{t('step2.body')}</p>
        <ol className="ghc-getstarted-sublist">
          <li>{t('step2.action1')}</li>
          <li>{t('step2.action2')}</li>
          <li>{t('step2.action3')}</li>
        </ol>
      </section>

      {/* Step 3 — Wait for admin approval */}
      <section className="ghc-getstarted-step">
        <div className="ghc-getstarted-step-header">
          <span className="ghc-getstarted-step-num">3</span>
          <h2>{t('step3.heading')}</h2>
        </div>
        <p>{t('step3.body')}</p>
        <div className="ghc-getstarted-callout">
          <span className="ghc-getstarted-callout-label">{t('step3.calloutLabel')}</span>
          <p>{t('step3.calloutBody')}</p>
        </div>
      </section>

      {/* Step 4 — Make your first call */}
      <section className="ghc-getstarted-step">
        <div className="ghc-getstarted-step-header">
          <span className="ghc-getstarted-step-num">4</span>
          <h2>{t('step4.heading')}</h2>
        </div>
        <p>{t('step4.body')}</p>

        <h3 className="ghc-getstarted-example-heading">
          {t('step4.example1Heading')}
        </h3>
        <p>{t('step4.example1Body')}</p>
        {statusCurl}

        <h3 className="ghc-getstarted-example-heading">
          {t('step4.example2Heading')}
        </h3>
        <p>{t('step4.example2Body')}</p>
        {repoCurl}

        <h3 className="ghc-getstarted-example-heading">
          {t('step4.example3Heading')}
        </h3>
        <p>{t('step4.example3Body')}</p>
        {batchCurl}

        <h3 className="ghc-getstarted-example-heading">
          {t('step4.errorsHeading')}
        </h3>
        <table className="ghc-getstarted-error-table">
          <thead>
            <tr>
              <th scope="col">{t('step4.errorCol.code')}</th>
              <th scope="col">{t('step4.errorCol.status')}</th>
              <th scope="col">{t('step4.errorCol.meaning')}</th>
            </tr>
          </thead>
          <tbody>
            {ERROR_ROWS.map((row) => (
              <tr key={row.code}>
                <td><code>{row.code}</code></td>
                <td>{row.http}</td>
                <td>{t(row.meaningKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Deeper reading */}
      <section className="ghc-getstarted-deeper">
        <h2>{t('deeper.heading')}</h2>
        <ul>
          <li>
            <a href="/docs">{t('deeper.apiRef')}</a>
            {' — '}{t('deeper.apiRefBody')}
          </li>
          <li>
            <a href="/docs/development">{t('deeper.devGuide')}</a>
            {' — '}{t('deeper.devGuideBody')}
          </li>
          <li>
            <a href="/api-docs.json" download>
              <code>/api-docs.json</code>
            </a>
            {' — '}{t('deeper.specBody')}
          </li>
        </ul>
      </section>
    </article>
  );
}