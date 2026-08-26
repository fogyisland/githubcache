import type { ReactElement } from 'react';

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
export function ApiShape({ owner, name, metadata }: ApiShapeProps): ReactElement {
  const apiPath = `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const json = JSON.stringify(metadata, null, 2);
  return (
    <section className="ghc-api-shape" data-testid="ghc-api-shape">
      <details className="ghc-api-shape-details">
        <summary className="ghc-api-shape-summary">
          <span className="ghc-section-eyebrow">Raw API shape</span>
          <span className="ghc-api-shape-hint">
            GET <code>{apiPath}</code> → same JSON
          </span>
        </summary>
        <pre className="ghc-code-block ghc-api-shape-pre">
          <code>{json}</code>
        </pre>
      </details>
    </section>
  );
}