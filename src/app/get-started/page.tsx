import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { CurlExample } from '../docs/_components/curl-example';

/**
 * `/get-started` — operator-facing walkthrough of the 4 steps required to
 * obtain an account, request an API key, get it approved, and make the
 * first authenticated call. Mirrors the `ghc-doc-*` style used by
 * `/docs` and `/docs/development` for visual consistency.
 */
export default async function GetStartedPage(): Promise<ReactElement> {
  const t = await getTranslations('getStarted');

  // Pre-await async sub-components before embedding in JSX (matches the
  // pattern used by /docs/development — required for static renderers).
  const sanityCurl = await CurlExample({
    method: 'GET',
    url: 'https://githubcache.example.com/api/v1/status',
  });
  const singleRepoCurl = await CurlExample({
    method: 'GET',
    url: 'https://githubcache.example.com/api/v1/repos/comfyanonymous/ComfyUI',
  });
  const batchCurl = await CurlExample({
    method: 'POST',
    url: 'https://githubcache.example.com/api/query',
    headers: { 'X-API-Key': 'ghp_your_key', 'Content-Type': 'application/json' },
    body: { nodes: [{ owner: 'fogyisland', name: 'githubcache' }] },
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <article className="ghc-doc-landing">
        <p className="ghc-section-eyebrow">{t('eyebrow')}</p>
        <h1 className="ghc-doc-h1">{t('title')}</h1>
        <p className="ghc-doc-lede">{t('lede')}</p>

      {/* ────────────────── 1. Ask an admin for an account ────────────────── */}
      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('step1.heading')}</h2>
        <p>{t('step1.body')}</p>
      </section>

      {/* ────────────────── 2. Request an API key ────────────────── */}
      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('step2.heading')}</h2>
        <p>{t('step2.body')}</p>
      </section>

      {/* ────────────────── 3. Wait for admin approval ────────────────── */}
      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('step3.heading')}</h2>
        <p>{t('step3.body')}</p>
      </section>

      {/* ────────────────── 4. Make your first call ────────────────── */}
      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('step4.heading')}</h2>

        <h3 className="ghc-doc-h3">{t('step4.sanityCaption')}</h3>
        {sanityCurl}

        <h3 className="ghc-doc-h3">{t('step4.singleRepoCaption')}</h3>
        {singleRepoCurl}

        <h3 className="ghc-doc-h3">{t('step4.batchCaption')}</h3>
        {batchCurl}

        <h3 className="ghc-doc-h3">{t('step4.responsesHeading')}</h3>
        <p>{t('step4.responsesIntro')}</p>
        <ul className="ghc-doc-list">
          <li>{t('step4.response200')}</li>
          <li>{t('step4.response4xx')}</li>
          <li>{t('step4.response429')}</li>
          <li>{t('step4.response404')}</li>
        </ul>
      </section>

      {/* ────────────────── Footer links to deeper references ────────────────── */}
      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('deeperHeading')}</h2>
        <ul className="ghc-doc-list">
          <li>
            <Link href="/docs">{t('deeperApi')}</Link>
          </li>
          <li>
            <Link href="/docs/development">{t('deeperDev')}</Link>
          </li>
        </ul>
      </section>
      </article>
    </main>
  );
}
