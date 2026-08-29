import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { CopyButton } from './copy-button';

interface DownloadSpecCardProps {
  /** Public base URL of the cache, no trailing slash. Used to build
   *  the cURL example. Falls back to a relative path when not set. */
  publicBaseUrl?: string;
}

/**
 * M15 — "Download API spec" card. Links to /api-docs.json and shows a
 * copy-cURL button. The JSON dump is the canonical machine-readable
 * summary of every public endpoint (paths, methods, auth, rate limits,
 * cache semantics, response samples, error codes).
 */
export async function DownloadSpecCard({
  publicBaseUrl,
}: DownloadSpecCardProps): Promise<ReactElement> {
  const t = await getTranslations('docs.landing.downloadSpec');
  const url = publicBaseUrl
    ? `${publicBaseUrl.replace(/\/$/, '')}/api-docs.json`
    : '/api-docs.json';
  const curl = `curl -fsS ${url}`;
  return (
    <section className="ghc-doc-section ghc-doc-download-card">
      <h2 className="ghc-doc-h2">{t('heading')}</h2>
      <p>{t('body')}</p>
      <div className="ghc-doc-download-actions">
        <a
          href={url}
          className="ghc-btn-secondary"
          download="api-docs.json"
          aria-label={t('fetch')}
        >
          {t('fetch')}
        </a>
        <CopyButton text={curl} label={t('copyCurl')} />
      </div>
    </section>
  );
}