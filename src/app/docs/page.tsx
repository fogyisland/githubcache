import type { ReactElement } from 'react';
import { CurlExample } from './_components/curl-example';
import { ENDPOINT_DOCS } from '@/lib/api-docs/registry';

export default function DocsLanding(): ReactElement {
  return (
    <article className="ghc-doc-landing">
      <p className="ghc-section-eyebrow">API Reference</p>
      <h1 className="ghc-doc-h1">GitHub Metadata Cache API</h1>
      <p className="ghc-doc-lede">
        Public, cache-backed access to GitHub repository metadata.
        Authenticated batch lookups, per-IP rate limits, and live
        system observability.
      </p>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">Quick start</h2>
        <p>Hit the public status endpoint first — no auth required:</p>
        <CurlExample method="GET" url="https://githubcache.example.com/api/v1/status" />
      </section>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">Endpoints</h2>
        <ul className="ghc-doc-endpoint-list">
          {ENDPOINT_DOCS.map((doc) => (
            <li key={doc.slug} className="ghc-doc-endpoint-list-item">
              <a href={`/docs/${doc.slug}`}>
                <span className={`ghc-doc-method ghc-doc-method-${doc.method}`}>{doc.method}</span>
                <code>{doc.path}</code>
              </a>
              <p className="ghc-doc-endpoint-summary">{doc.summary}</p>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
