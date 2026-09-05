import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { CurlExample } from '../_components/curl-example';

/**
 * `/docs/development` — public-facing development & contribution guide.
 *
 * Three sections:
 *  1. For users of the public API — quick-start curl + links to per-endpoint docs
 *  2. For local developers — clone → install → DB → dev server
 *  3. For contributors — fork → branch → quality gates → PR
 *
 * Kept intentionally short: detailed architecture / milestones / conventions
 * live in `CLAUDE.md` and `docs/runbook.md` (linked from the page footer).
 */
export default async function DocsDevelopmentPage(): Promise<ReactElement> {
  const t = await getTranslations('docs.development');
  const statusCurl = await CurlExample({
    method: 'GET',
    url: 'https://githubcache.example.com/api/v1/status',
  });
  const repoCurl = await CurlExample({
    method: 'GET',
    url: 'https://githubcache.example.com/api/v1/repos/comfyanonymous/ComfyUI',
  });

  return (
    <article className="ghc-doc-landing">
      <p className="ghc-section-eyebrow">{t('eyebrow')}</p>
      <h1 className="ghc-doc-h1">{t('title')}</h1>
      <p className="ghc-doc-lede">{t('lede')}</p>

      {/* ────────────────── 1. Using the public API ────────────────── */}
      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('apiUsers.heading')}</h2>
        <p>{t('apiUsers.body')}</p>

        <h3 className="ghc-doc-h3">{t('apiUsers.quickCheck')}</h3>
        <p>{t('apiUsers.quickCheckBody')}</p>
        {statusCurl}

        <h3 className="ghc-doc-h3">{t('apiUsers.singleRepo')}</h3>
        <p>{t('apiUsers.singleRepoBody')}</p>
        {repoCurl}

        <h3 className="ghc-doc-h3">{t('apiUsers.endpointsHeading')}</h3>
        <ul className="ghc-doc-list">
          <li>
            <Link href="/docs/api/v1-status">{t('apiUsers.v1Status')}</Link>
            {' — '}{t('apiUsers.v1StatusBody')}
          </li>
          <li>
            <Link href="/docs/api/v1-repos">{t('apiUsers.v1Repos')}</Link>
            {' — '}{t('apiUsers.v1ReposBody')}
          </li>
          <li>
            <Link href="/docs/api/query">{t('apiUsers.v1Query')}</Link>
            {' — '}{t('apiUsers.v1QueryBody')}
          </li>
        </ul>

        <h3 className="ghc-doc-h3">{t('apiUsers.machineReadable')}</h3>
        <p>
          <a href="/api-docs.json" download>
            <code>/api-docs.json</code>
          </a>
          {' — '}{t('apiUsers.machineReadableBody')}
        </p>
      </section>

      {/* ────────────────── 2. Local development ────────────────── */}
      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('localDev.heading')}</h2>
        <p>{t('localDev.body')}</p>

        <ol className="ghc-doc-list">
          <li>
            <strong>{t('localDev.step1Label')}</strong>{' '}
            <code>git clone https://github.com/fogyisland/githubcache.git</code>
          </li>
          <li>
            <strong>{t('localDev.step2Label')}</strong>{' '}
            <code>cp .env.example .env</code> — set{' '}
            <code>DATABASE_URL</code> (MySQL 5.7+) and{' '}
            <code>SESSION_SECRET</code> (≥32 chars)
          </li>
          <li>
            <strong>{t('localDev.step3Label')}</strong>{' '}
            <code>npm install</code>
          </li>
          <li>
            <strong>{t('localDev.step4Label')}</strong>{' '}
            <code>npx prisma migrate deploy</code>
          </li>
          <li>
            <strong>{t('localDev.step5Label')}</strong>{' '}
            <code>npm run dev:server</code> — boots Next + scheduler + pool on{' '}
            <code>localhost:5002</code>
          </li>
          <li>
            <strong>{t('localDev.step6Label')}</strong>{' '}
            <code>curl http://localhost:5002/api/v1/status</code>
          </li>
        </ol>

        <h3 className="ghc-doc-h3">{t('localDev.qualityGates')}</h3>
        <ul className="ghc-doc-list">
          <li><code>npm run typecheck</code> — {t('localDev.typecheck')}</li>
          <li><code>npm run lint</code> — {t('localDev.lint')}</li>
          <li><code>npm test</code> — {t('localDev.test')}</li>
          <li><code>npm run build</code> — {t('localDev.build')}</li>
        </ul>

        <p>
          <a href="/docs/development#github-token">{t('localDev.tokenHelp')}</a>
        </p>
      </section>

      {/* ────────────────── 3. Contributing ────────────────── */}
      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('contributing.heading')}</h2>
        <p>{t('contributing.body')}</p>

        <h3 className="ghc-doc-h3">{t('contributing.fork')}</h3>
        <ol className="ghc-doc-list">
          <li>
            {t('contributing.forkStep1')}{' '}
            <a href="https://github.com/fogyisland/githubcache/fork">
              github.com/fogyisland/githubcache/fork
            </a>
          </li>
          <li>
            <code>git checkout -b feat/your-change</code>
          </li>
          <li>
            {t('contributing.forkStep3')}
          </li>
          <li>
            {t('contributing.forkStep4')}
          </li>
          <li>
            <code>git push origin feat/your-change</code>
          </li>
          <li>
            {t('contributing.forkStep5')}{' '}
            <a href="https://github.com/fogyisland/githubcache/compare">
              github.com/fogyisland/githubcache/compare
            </a>
          </li>
        </ol>

        <h3 className="ghc-doc-h3">{t('contributing.commitStyle')}</h3>
        <ul className="ghc-doc-list">
          <li><strong>{t('contributing.scope')}</strong>{' — '}<code>feat(M22): ...</code> · <code>fix(api-shape): ...</code> · <code>docs(M24): ...</code></li>
          <li><strong>{t('contributing.subject')}</strong>{' — '}{t('contributing.subjectBody')}</li>
          <li><strong>{t('contributing.body')}</strong> — {t('contributing.bodyBody')}</li>
          <li><strong>Co-Authored-By</strong>: <code>Claude &lt;noreply@anthropic.com&gt;</code> {t('contributing.coAuthoredBody')}</li>
        </ul>

        <h3 className="ghc-doc-h3">{t('contributing.styleGuide')}</h3>
        <ul className="ghc-doc-list">
          <li>{t('contributing.style1')}</li>
          <li>{t('contributing.style2')}</li>
          <li>{t('contributing.style3')}</li>
          <li>{t('contributing.style4')}</li>
          <li>{t('contributing.style5')}</li>
        </ul>

        <h3 id="github-token" className="ghc-doc-h3">{t('contributing.tokenHeading')}</h3>
        <p>{t('contributing.tokenBody')}</p>
      </section>

      {/* ────────────────── Links to deeper docs ────────────────── */}
      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('deeper.heading')}</h2>
        <ul className="ghc-doc-list">
          <li>
            <a
              href="https://github.com/fogyisland/githubcache/blob/master/CLAUDE.md"
            >
              CLAUDE.md
            </a>
            {' — '}{t('deeper.claude')}
          </li>
          <li>
            <a href="/docs/runbook.md">
              docs/runbook.md
            </a>
            {' — '}{t('deeper.runbook')}
          </li>
          <li>
            <a
              href="https://github.com/fogyisland/githubcache/blob/master/README.md"
            >
              README.md
            </a>
            {' — '}{t('deeper.readme')}
          </li>
        </ul>
      </section>
    </article>
  );
}
