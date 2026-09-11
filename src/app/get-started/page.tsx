import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { CopyButton } from './_components/copy-button';
import { CodeTabs } from './_components/code-tabs';

/**
 * `/get-started` — public-facing walkthrough for a brand-new visitor.
 *
 * Four sequential steps:
 *
 *   1. /signup            →  operator account, auto-logged in
 *   2. /account/keys/…    →  pending API key request
 *   3. (admin approves)   →  plaintext token, shown ONCE + emailed
 *   4. curl examples      →  three calls from no-auth to batch
 *
 * Layout: a single 1-column reading flow on all viewports. The four
 * step cards stack vertically with a thin accent connector running
 * through the step-number circles on desktop (`.ghc-getstarted-timeline`
 * in globals.css). Mobile drops the connector.
 *
 * The .ghc-getstarted-* CSS classes are defined in globals.css. Step
 * numbers are auto-generated via a `counter-reset: ghc-step` block —
 * the markup doesn't hardcode 1/2/3/4, so reordering steps in the
 * array automatically re-numbers them.
 */

// --- inline code-example: builds curl / python / nodejs / powershell
// snippets for one HTTP request and wraps them in a client-side tab
// component. Docs site was retired in M17; this is the only consumer.
interface CodeExampleProps {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  tag: 'public' | 'single' | 'batch';
  copyLabel: string;
  copiedLabel: string;
  tagLabel: string;
  tabLabels: Record<'curl' | 'python' | 'nodejs' | 'powershell', string>;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function buildCurlCommand({ method, url, headers, body }: CodeExampleProps): string {
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

function buildPython({ method, url, headers, body }: CodeExampleProps): string {
  const lines: string[] = ['import requests', ''];
  lines.push(`response = requests.${method.toLowerCase()}(`);
  lines.push(`    ${shellQuote(url)},`);
  if (headers && Object.keys(headers).length > 0) {
    lines.push('    headers={');
    for (const [k, v] of Object.entries(headers)) {
      lines.push(`        ${shellQuote(k)}: ${shellQuote(v)},`);
    }
    lines.push('    },');
  }
  if (body !== undefined) {
    lines.push(`    json=${JSON.stringify(body, null, 4).replace(/\n/g, '\n    ')},`);
  }
  lines.push(')');
  lines.push('print(response.json())');
  return lines.join('\n');
}

function buildNodejs({ method, url, headers, body }: CodeExampleProps): string {
  const opts: Record<string, unknown> = { method };
  if (headers && Object.keys(headers).length > 0) {
    opts.headers = headers;
  }
  if (body !== undefined) {
    opts.body = JSON.stringify(body, null, 2);
  }
  const optsJson = JSON.stringify(opts, null, 2);
  return [
    `const response = await fetch(${JSON.stringify(url)}, ${optsJson});`,
    'const data = await response.json();',
    'console.log(data);',
  ].join('\n');
}

function buildPowershell({ method, url, headers, body }: CodeExampleProps): string {
  const lines: string[] = [];
  const hasHeaders = headers && Object.keys(headers).length > 0;
  if (hasHeaders) {
    lines.push('$headers = @{');
    for (const [k, v] of Object.entries(headers ?? {})) {
      lines.push(`    ${shellQuote(k)} = ${shellQuote(v)}`);
    }
    lines.push('}');
    lines.push('');
  }
  if (body !== undefined) {
    lines.push(`$body = ${JSON.stringify(body)} | ConvertTo-Json -Compress`);
    lines.push('');
  }
  const cmdlet = hasHeaders ? 'Invoke-RestMethod' : 'Invoke-WebRequest';
  const args = ['-Method', method.toUpperCase(), '-Uri', shellQuote(url)];
  if (hasHeaders) args.push('-Headers', '$headers');
  if (body !== undefined) args.push('-Body', '$body', '-ContentType', "'application/json'");
  lines.push(`$response = ${cmdlet} ${args.join(' ')}`);
  lines.push('$response | ConvertTo-Json');
  return lines.join('\n');
}

async function CodeExample(props: CodeExampleProps): Promise<ReactElement> {
  const tTags = await getTranslations('getStarted.step4');
  const snippets = [
    { lang: 'curl' as const, code: buildCurlCommand(props) },
    { lang: 'python' as const, code: buildPython(props) },
    { lang: 'nodejs' as const, code: buildNodejs(props) },
    { lang: 'powershell' as const, code: buildPowershell(props) },
  ];
  return (
    <div className="ghc-getstarted-example-wrapper">
      <span className={`ghc-getstarted-curl-tag ghc-getstarted-curl-tag-${props.tag}`}>
        {tTags(props.tagLabel)}
      </span>
      <CodeTabs
        snippets={snippets}
        tabLabels={props.tabLabels}
        copyLabel={props.copyLabel}
        copiedLabel={props.copiedLabel}
        ariaLabel={`${props.method} ${props.url}`}
      />
    </div>
  );
}

const ERROR_ROWS = [
  { code: 'unauthorized', http: 401, meaningKey: 'errors.unauthorized' },
  { code: 'forbidden', http: 403, meaningKey: 'errors.forbidden' },
  { code: 'rate_limited', http: 429, meaningKey: 'errors.rate_limited' },
  { code: 'not_found', http: 404, meaningKey: 'errors.not_found' },
] as const;

interface Step {
  id: 'step1' | 'step2' | 'step3' | 'step4';
  headingKey: string;
  bodyKey: string;
  extra?: (t: Awaited<ReturnType<typeof getTranslations<'getStarted'>>>) => Promise<ReactElement>;
  cta?: { href: string; className: string; labelKey: string };
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('getStarted.meta');
  return { title: t('title'), description: t('description') };
}

export default async function GetStartedPage(): Promise<ReactElement> {
  const t = await getTranslations('getStarted');
  const tCopy = await getTranslations('getStarted.copy');
  const tStep4 = await getTranslations('getStarted.step4');
  const tTabs = await getTranslations('getStarted.tabs');

  const tabLabels = {
    curl: tTabs('curl'),
    python: tTabs('python'),
    nodejs: tTabs('nodejs'),
    powershell: tTabs('powershell'),
  };

  const statusExample = await CodeExample({
    method: 'GET',
    url: 'https://githubcache.example.com/api/v1/status',
    tag: 'public',
    copyLabel: tCopy('copy'),
    copiedLabel: tCopy('copied'),
    tagLabel: 'tagPublic',
    tabLabels,
  });
  const repoExample = await CodeExample({
    method: 'GET',
    url: 'https://githubcache.example.com/api/v1/repos/facebook/react',
    headers: { 'X-API-Key': 'YOUR_KEY_HERE' },
    tag: 'single',
    copyLabel: tCopy('copy'),
    copiedLabel: tCopy('copied'),
    tagLabel: 'tagSingle',
    tabLabels,
  });
  const batchExample = await CodeExample({
    method: 'POST',
    url: 'https://githubcache.example.com/api/query',
    headers: { 'X-API-Key': 'YOUR_KEY_HERE' },
    body: { nodes: [{ owner: 'facebook', name: 'react' }] },
    tag: 'batch',
    copyLabel: tCopy('copy'),
    copiedLabel: tCopy('copied'),
    tagLabel: 'tagBatch',
    tabLabels,
  });

  const steps: Step[] = [
    {
      id: 'step1',
      headingKey: 'step1.heading',
      bodyKey: 'step1.body',
      cta: { href: '/signup', className: 'ghc-btn-primary', labelKey: 'step1.cta' },
    },
    {
      id: 'step2',
      headingKey: 'step2.heading',
      bodyKey: 'step2.body',
      cta: {
        href: '/account/keys/request',
        className: 'ghc-btn-secondary',
        labelKey: 'step2.cta',
      },
    },
    {
      id: 'step3',
      headingKey: 'step3.heading',
      bodyKey: 'step3.body',
      extra: async () => (
        <div className="ghc-getstarted-callout">
          <span className="ghc-getstarted-callout-label">{t('step3.calloutLabel')}</span>
          <p>{t('step3.calloutBody')}</p>
        </div>
      ),
    },
    {
      id: 'step4',
      headingKey: 'step4.heading',
      bodyKey: 'step4.body',
      extra: async () => (
        <>
          <h3 className="ghc-getstarted-example-heading">{tStep4('example1Heading')}</h3>
          <p className="ghc-getstarted-example-body">{tStep4('example1Body')}</p>
          {statusExample}

          <h3 className="ghc-getstarted-example-heading">{tStep4('example2Heading')}</h3>
          <p className="ghc-getstarted-example-body">{tStep4('example2Body')}</p>
          {repoExample}

          <h3 className="ghc-getstarted-example-heading">{tStep4('example3Heading')}</h3>
          <p className="ghc-getstarted-example-body">{tStep4('example3Body')}</p>
          {batchExample}

          <h3 className="ghc-getstarted-example-heading">{tStep4('errorsHeading')}</h3>
          <table className="ghc-getstarted-error-table">
            <thead>
              <tr>
                <th scope="col">{tStep4('errorCol.code')}</th>
                <th scope="col">{tStep4('errorCol.status')}</th>
                <th scope="col">{tStep4('errorCol.meaning')}</th>
              </tr>
            </thead>
            <tbody>
              {ERROR_ROWS.map((row) => (
                <tr key={row.code}>
                  <td>
                    <code>{row.code}</code>
                  </td>
                  <td>
                    <span className={`ghc-getstarted-status ghc-getstarted-status-${row.http}`}>
                      {row.http}
                    </span>
                  </td>
                  <td>{tStep4(row.meaningKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ),
    },
  ];

  // Pre-resolve each step's `extra` content (all independent async calls).
  const stepExtras = await Promise.all(steps.map((s) => (s.extra ? s.extra(t) : null)));

  return (
    <article className="ghc-getstarted">
      <span className="ghc-getstarted-eyebrow">{t('eyebrow')}</span>
      <h1 className="ghc-getstarted-h1">{t('title')}</h1>
      <p className="ghc-getstarted-lede">{t('lede')}</p>

      {/* === Steps: 1 → 4, vertical stack on all viewports === */}
      <ol className="ghc-getstarted-steps">
        {steps.map((s, idx) => (
          <li key={s.id} className="ghc-getstarted-step" aria-labelledby={`ghc-gs-${s.id}`}>
            <div className="ghc-getstarted-step-header">
              <span className="ghc-getstarted-step-num" aria-hidden="true" />
              <h2 id={`ghc-gs-${s.id}`}>{t(s.headingKey)}</h2>
            </div>
            <p>{t(s.bodyKey)}</p>
            {s.cta ? (
              <p className="ghc-getstarted-cta-row">
                <Link href={s.cta.href} className={s.cta.className}>
                  {t(s.cta.labelKey)}
                </Link>
              </p>
            ) : null}
            {stepExtras[idx]}
          </li>
        ))}
      </ol>

      {/* === Deeper reading === */}
      <section className="ghc-getstarted-deeper">
        <h2>{t('deeper.heading')}</h2>
        <dl className="ghc-getstarted-deeper-list">
          <div>
            <dt>
              <Link href="/docs">{t('deeper.apiRef')}</Link>
            </dt>
            <dd>{t('deeper.apiRefBody')}</dd>
          </div>
          <div>
            <dt>
              <Link href="/docs/development">{t('deeper.devGuide')}</Link>
            </dt>
            <dd>{t('deeper.devGuideBody')}</dd>
          </div>
          <div>
            <dt>
              <Link href="/account/keys">{t('deeper.yourKeys')}</Link>
            </dt>
            <dd>{t('deeper.yourKeysBody')}</dd>
          </div>
          <div>
            <dt>
              <a href="/api-docs.json" download>
                <code>/api-docs.json</code>
              </a>
            </dt>
            <dd>{t('deeper.specBody')}</dd>
          </div>
        </dl>
      </section>
    </article>
  );
}