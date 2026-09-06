import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CurlExample } from '@/app/docs/_components/curl-example';

/**
 * `/get-started` — public-facing walkthrough that takes a brand-new user
 * from "what is this" to "I just got a 200 response". Lives outside
 * `/docs` because the docs are operator-grade API reference; this page
 * is the on-ramp.
 *
 * Four numbered steps:
 *   1. Ask an admin for an account (invite-only; no self-signup).
 *   2. Request an API key (logged-in user, becomes `pending`).
 *   3. Wait for admin approval (admin clicks Approve; one-time plaintext).
 *   4. Make the first call (three curl examples, no key → v1 key → batch).
 *
 * Reuses `.ghc-doc-*` styles from globals.css + the existing CurlExample
 * component so this page looks identical to `/docs`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('getStarted.meta');
  return { title: t('title'), description: t('description') };
}

export default async function GetStartedPage(): Promise<ReactElement> {
  const t = await getTranslations('getStarted');

  // Three real curl examples — pre-async CurlExample so non-RSC renderers
  // (vitest renderToStaticMarkup) can resolve them.
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
    <article className="ghc-doc-landing ghc-getstarted">
      <p className="ghc-section-eyebrow">{t('eyebrow')}</p>
      <h1 className="ghc-doc-h1">{t('title')}</h1>
      <p className="ghc-doc-lede">{t('lede')}</p>

      {/* ─────────────────── Step 1: Ask for an account ─────────────────── */}
      <section className="ghc-getstarted-step" data-step="1">
        <div className="ghc-getstarted-step-number">{t('step1.number')}</div>
        <div className="ghc-getstarted-step-body">
          <h2 className="ghc-doc-h2">{t('step1.heading')}</h2>
          <p>{t('step1.body')}</p>
          <div className="ghc-getstarted-callout">
            <strong>{t('step1.calloutHeading')}</strong>
            <span>{t('step1.calloutBody')}</span>
          </div>
        </div>
      </section>

      {/* ─────────────────── Step 2: Request an API key ─────────────────── */}
      <section className="ghc-getstarted-step" data-step="2">
        <div className="ghc-getstarted-step-number">{t('step2.number')}</div>
        <div className="ghc-getstarted-step-body">
          <h2 className="ghc-doc-h2">{t('step2.heading')}</h2>
          <p>{t('step2.body')}</p>
          <ol className="ghc-getstarted-sublist">
            <li>{t('step2.action1')}</li>
            <li>{t('step2.action2')}</li>
            <li>{t('step2.action3')}</li>
          </ol>
        </div>
      </section>

      {/* ─────────────────── Step 3: Wait for admin approval ─────────────────── */}
      <section className="ghc-getstarted-step" data-step="3">
        <div className="ghc-getstarted-step-number">{t('step3.number')}</div>
        <div className="ghc-getstarted-step-body">
          <h2 className="ghc-doc-h2">{t('step3.heading')}</h2>
          <p>{t('step3.body')}</p>
          <div className="ghc-getstarted-callout">
            <strong>{t('step3.calloutHeading')}</strong>
            <span>{t('step3.calloutBody')}</span>
          </div>
        </div>
      </section>

      {/* ─────────────────── Step 4: Make the first call ─────────────────── */}
      <section className="ghc-getstarted-step" data-step="4">
        <div className="ghc-getstarted-step-number">{t('step4.number')}</div>
        <div className="ghc-getstarted-step-body">
          <h2 className="ghc-doc-h2">{t('step4.heading')}</h2>
          <p>{t('step4.body')}</p>

          <h3 className="ghc-doc-h3">{t('step4.example1Heading')}</h3>
          <p>{t('step4.example1Body')}</p>
          {statusCurl}

          <h3 className="ghc-doc-h3">{t('step4.example2Heading')}</h3>
          <p>{t('step4.example2Body')}</p>
          {repoCurl}

          <h3 className="ghc-doc-h3">{t('step4.example3Heading')}</h3>
          <p>{t('step4.example3Body')}</p>
          {batchCurl}

          <h3 className="ghc-doc-h3">{t('step4.errorsHeading')}</h3>
          <table className="ghc-getstarted-error-table">
            <thead>
              <tr>
                <th scope="col">{t('step4.errorCol.code')}</th>
                <th scope="col">{t('step4.errorCol.status')}</th>
                <th scope="col">{t('step4.errorCol.meaning')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>unauthorized</code></td>
                <td>401</td>
                <td>{t('step4.errors.unauthorized')}</td>
              </tr>
              <tr>
                <td><code>forbidden</code></td>
                <td>403</td>
                <td>{t('step4.errors.forbidden')}</td>
              </tr>
              <tr>
                <td><code>rate_limited</code></td>
                <td>429</td>
                <td>{t('step4.errors.rate_limited')}</td>
              </tr>
              <tr>
                <td><code>not_found</code></td>
                <td>404</td>
                <td>{t('step4.errors.not_found')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ─────────────────── Deeper reading ─────────────────── */}
      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('deeper.heading')}</h2>
        <ul className="ghc-doc-list">
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
