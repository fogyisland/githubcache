import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CurlExample } from '@/app/docs/_components/curl-example';

/**
 * `/get-started` — public-facing walkthrough that takes a brand-new user
 * from "what is this" to "I just got a 200 response".
 *
 * Visual direction: Repository Tree (paper surface). The page reads as a
 * `git log` of the four steps you take to become a githubcache API user.
 *
 *   - Wrapper `.ghc-paper` opts the page into the paper tokens (warm
 *     off-white + sienna accent + zero radius).
 *   - `.ghc-getstarted-treeheader` shows the file path being read.
 *   - `.ghc-getstarted-log` draws a vertical connector line down the left;
 *     each step is a commit node on that line.
 *   - Step body uses Fraunces serif (titles) + IBM Plex Sans (prose) +
 *     JetBrains Mono (SHA / data / code).
 *
 * Reuses the existing `CurlExample` component (restyled under `.ghc-paper`)
 * so copy-to-clipboard stays consistent with /docs.
 */

const STEPS = [
  {
    sha: 'a3f7c1d',
    author: 'admin',
    kind: 'feat' as const,
    titleKey: 'step1.heading',
    bodyKey: 'step1.body',
    noteLabelKey: 'step1.calloutHeading',
    noteBodyKey: 'step1.calloutBody',
  },
  {
    sha: 'b1d49ee',
    author: 'you',
    kind: 'feat' as const,
    titleKey: 'step2.heading',
    bodyKey: 'step2.body',
    actionsKey: ['step2.action1', 'step2.action2', 'step2.action3'] as const,
  },
  {
    sha: '7c8a02f',
    author: 'admin',
    kind: 'chore' as const,
    titleKey: 'step3.heading',
    bodyKey: 'step3.body',
    noteLabelKey: 'step3.calloutHeading',
    noteBodyKey: 'step3.calloutBody',
  },
  {
    sha: 'e02a519',
    author: 'you',
    kind: 'docs' as const,
    titleKey: 'step4.heading',
    bodyKey: 'step4.body',
  },
] as const;

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
    <article className="ghc-paper ghc-getstarted">
      {/* File-tree header — reads as "you're viewing docs/get-started.md in
          the githubcache repo". */}
      <div className="ghc-getstarted-treeheader">
        <div className="ghc-path">
          githubcache
          <span className="ghc-path-sep">/</span>
          docs
          <span className="ghc-path-sep">/</span>
          <span className="ghc-path-leaf">get-started.md</span>
        </div>
        <div className="ghc-path">
          main <span className="ghc-path-sep">·</span> {t('treeheader.branch')}
        </div>
      </div>

      <h1 className="ghc-getstarted-h1">{t('title')}</h1>
      <p className="ghc-getstarted-lede">{t('lede')}</p>

      {/* Commit log — four steps as commits on a shared branch. */}
      <ol className="ghc-getstarted-log">
        {STEPS.map((step, i) => {
          const stepNum = i + 1;
          return (
            <li
              key={step.sha}
              className="ghc-getstarted-commit"
              data-commit-kind={step.kind}
              data-step={stepNum}
            >
              <div className="ghc-getstarted-sha">
                <span className="sha">{step.sha}</span>
                <span className="author">{step.author}</span>
                <span>
                  <span className="meta-sep">·</span> {t('treeheader.commitStep', { n: stepNum })}
                </span>
                <span className="meta-sep">·</span>
                <span>{step.kind}</span>
              </div>
              <h2>{t(step.titleKey)}</h2>
              <p>{t(step.bodyKey)}</p>

              {'actionsKey' in step && step.actionsKey ? (
                <ol className="ghc-getstarted-sublist">
                  {step.actionsKey.map((k) => (
                    <li key={k}>{t(k)}</li>
                  ))}
                </ol>
              ) : null}

              {'noteLabelKey' in step && step.noteLabelKey && 'noteBodyKey' in step && step.noteBodyKey ? (
                <div className="ghc-getstarted-note">
                  <span className="ghc-getstarted-note-label">{t(step.noteLabelKey)}</span>
                  <p>{t(step.noteBodyKey)}</p>
                </div>
              ) : null}

              {stepNum === 4 ? (
                <>
                  <h3 className="ghc-getstarted-h3">{t('step4.example1Heading')}</h3>
                  <p>{t('step4.example1Body')}</p>
                  {statusCurl}

                  <h3 className="ghc-getstarted-h3">{t('step4.example2Heading')}</h3>
                  <p>{t('step4.example2Body')}</p>
                  {repoCurl}

                  <h3 className="ghc-getstarted-h3">{t('step4.example3Heading')}</h3>
                  <p>{t('step4.example3Body')}</p>
                  {batchCurl}

                  <h3 className="ghc-getstarted-h3">{t('step4.errorsHeading')}</h3>
                  <table className="ghc-getstarted-errortable">
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
                </>
              ) : null}
            </li>
          );
        })}
      </ol>

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

      {/* Blame row — file metadata footer. */}
      <div className="ghc-getstarted-blame">
        <span>{t('blame.lastTouched')}</span>
        <span className="blame-sep">·</span>
        <span>{t('blame.author')}</span>
        <span className="blame-sep">·</span>
        <span>{t('blame.version')}</span>
      </div>
    </article>
  );
}
