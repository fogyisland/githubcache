import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

interface ApiShapeProps {
  owner: string;
  name: string;
  metadata: unknown;
}

/**
 * Collapsible JSON dump of the full repo metadata the cache holds.
 * Surfaces the raw /api/v1/repos/{owner}/{name} shape so engineers can
 * see exactly what fields the cache preserves, and link to the live
 * public API endpoint to fetch the same shape programmatically.
 */
export async function ApiShape({ owner, name, metadata }: ApiShapeProps): Promise<ReactElement> {
  const t = await getTranslations('repo.apiShape');
  const apiPath = `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const json = JSON.stringify(metadata, null, 2);
  return (
    <section className="ghc-api-shape" data-testid="ghc-api-shape">
      <details className="ghc-api-shape-details">
        <summary className="ghc-api-shape-summary">
          <span className="ghc-section-eyebrow">{t('eyebrow')}</span>
          {/* Composed from 3 i18n fragments instead of t.rich: next-intl 4's
              SSR path stringifies no-arg callbacks instead of invoking them,
              which would render literal "function transformed" text. The
              dynamic parts (apiPath + docs URL) are inline JSX; only the
              connector words translate. See memory: feedback_next_intl_rich_callbacks. */}
          <a className="ghc-api-shape-hint" href={`/docs/api/v1-repos`}>
            {t('hintPrefix')}
            <code>{apiPath}</code>
            {t('hintMiddle')}
            <span className="ghc-api-shape-link">/docs/api/v1-repos</span>
            {t('hintSuffix')}
          </a>
        </summary>
        <pre className="ghc-code-block ghc-api-shape-pre">
          <code>{json}</code>
        </pre>
      </details>
    </section>
  );
}
