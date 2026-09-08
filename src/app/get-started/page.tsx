import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/**
 * `/get-started` — public-facing walkthrough for a brand-new visitor.
 *
 * Updated for M26 — public signup + self-service key request replaces the
 * old admin-invite flow. Four steps:
 *
 *   1. /signup            →  operator account, auto-logged in
 *   2. /account/keys/…    →  pending API key request
 *   3. (admin approves)   →  plaintext token, shown ONCE + emailed
 *   4. curl examples      →  three calls from no-auth to batch
 *
 * Visual: Wulan-aligned step cards (light surface + sky-blue accent + 6px
 * radius + sans body) so the look matches /docs and /docs/development.
 * The .ghc-getstarted-step / -num / -callout CSS classes are defined in
 * globals.css.
 */

// --- inline curl-example (was extracted to docs/_components in M17, but the
// docs site is no longer shipped and get-started is the only consumer) ---
interface CurlExampleProps {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}
function buildCurlCommand({ method, url, headers, body }: CurlExampleProps): string {
  const parts = ['curl', '-X', method, shellQuote(url)];
  for (const [k, v] of Object.entries(headers ?? {})) {
    parts.push('-H', shellQuote(`${k}: ${v}`));
  }
  if (body !== undefined) {
    parts.push('-H', shellQuote('Content-Type: application/json'));
    parts.push('--data', shellQuote(JSON.stringify(body)));
  }
  return parts.join(' ');
}
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
async function CurlExample(props: CurlExampleProps): Promise<ReactElement> {
  const cmd = buildCurlCommand(props);
  return (
    <pre className="ghc-getstarted-curl">
      <code>{cmd}</code>
    </pre>
  );
}

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
    headers: { 'X-API-Key': 'YOUR_KEY_HERE' },
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

      {/* === STEP 1 — Sign up === */}
      <section className="ghc-getstarted-step" aria-labelledby="ghc-gs-step-1">
        <div className="ghc-getstarted-step-header">
          <span className="ghc-getstarted-step-num">1</span>
          <h2 id="ghc-gs-step-1">{t('step1.heading')}</h2>
        </div>
        <p>{t('step1.body')}</p>
        <ol className="ghc-getstarted-sublist">
          <li>{t('step1.action1')}</li>
          <li>{t('step1.action2')}</li>
          <li>{t('step1.action3')}</li>
        </ol>
        <p className="ghc-getstarted-cta-row">
          <Link href="/signup" className="ghc-btn-primary">
            {t('step1.cta')}
          </Link>
        </p>
      </section>

      {/* === STEP 2 — Request an API key === */}
      <section className="ghc-getstarted-step" aria-labelledby="ghc-gs-step-2">
        <div className="ghc-getstarted-step-header">
          <span className="ghc-getstarted-step-num">2</span>
          <h2 id="ghc-gs-step-2">{t('step2.heading')}</h2>
        </div>
        <p>{t('step2.body')}</p>
        <ol className="ghc-getstarted-sublist">
          <li>{t('step2.action1')}</li>
          <li>{t('step2.action2')}</li>
          <li>{t('step2.action3')}</li>
        </ol>
        <p className="ghc-getstarted-cta-row">
          <Link href="/account/keys/request" className="ghc-btn-secondary">
            {t('step2.cta')}
          </Link>
        </p>
      </section>

      {/* === STEP 3 — Admin approval === */}
      <section className="ghc-getstarted-step" aria-labelledby="ghc-gs-step-3">
        <div className="ghc-getstarted-step-header">
          <span className="ghc-getstarted-step-num">3</span>
          <h2 id="ghc-gs-step-3">{t('step3.heading')}</h2>
        </div>
        <p>{t('step3.body')}</p>
        <div className="ghc-getstarted-callout">
          <span className="ghc-getstarted-callout-label">{t('step3.calloutLabel')}</span>
          <p>{t('step3.calloutBody')}</p>
        </div>
      </section>

      {/* === STEP 4 — Make your first call === */}
      <section className="ghc-getstarted-step" aria-labelledby="ghc-gs-step-4">
        <div className="ghc-getstarted-step-header">
          <span className="ghc-getstarted-step-num">4</span>
          <h2 id="ghc-gs-step-4">{t('step4.heading')}</h2>
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

      {/* === Deeper reading === */}
      <section className="ghc-getstarted-deeper">
        <h2>{t('deeper.heading')}</h2>
        <ul>
          <li>
            <Link href="/docs">{t('deeper.apiRef')}</Link>
            {' — '}{t('deeper.apiRefBody')}
          </li>
          <li>
            <Link href="/docs/development">{t('deeper.devGuide')}</Link>
            {' — '}{t('deeper.devGuideBody')}
          </li>
          <li>
            <Link href="/account/keys">{t('deeper.yourKeys')}</Link>
            {' — '}{t('deeper.yourKeysBody')}
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
