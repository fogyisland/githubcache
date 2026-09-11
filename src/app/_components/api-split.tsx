import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

/**
 * Side-by-side API preview: curl request on left, trimmed JSON response on right.
 * Server component. Code blocks use ghc-code-block for monospace + light bg.
 */
export async function ApiSplit(): Promise<ReactElement> {
  const t = await getTranslations('home.apiPreview');
  const curlCmd = `curl https://api.githubcache.dev/api/v1/repos/facebook/react`;
  const responseJson = `{
  "owner": "facebook",
  "name": "react",
  "stars": 234567,
  "forks": 49000,
  "language": "JavaScript",
  "license": "MIT",
  "topics": ["frontend", "ui"],
  "cached_at": "2026-09-10T12:00:00Z"
}`;

  return (
    <section className="ghc-api-split" data-testid="ghc-api-split">
      <div className="ghc-section-eyebrow">{t('eyebrow')}</div>
      <h2 className="ghc-section-heading">{t('heading')}</h2>
      <div className="ghc-api-split-grid">
        <div className="ghc-code-block">
          <div className="ghc-code-block-label">{t('request')}</div>
          <pre className="ghc-code-block-content"><code>{curlCmd}</code></pre>
        </div>
        <div className="ghc-code-block">
          <div className="ghc-code-block-label">{t('response')}</div>
          <pre className="ghc-code-block-content"><code>{responseJson}</code></pre>
        </div>
      </div>
    </section>
  );
}