import type { ReactElement } from 'react';
import type { EndpointDoc } from '@/lib/api-docs/types';
import { CurlExample } from './curl-example';
import { SchemaViewer } from './schema-viewer';
import { ResponseExample } from './response-example';
import { HeadersTable } from './headers-table';
import { ErrorsTable } from './errors-table';
import { queryBodySchema } from '@/lib/api-docs/schemas/query';

interface EndpointPageProps {
  doc: EndpointDoc;
}

function buildUrl(doc: EndpointDoc): string {
  return `https://githubcache.example.com${doc.path}`;
}

function curlHeaders(doc: EndpointDoc): Record<string, string> | undefined {
  if (doc.auth === 'X-API-Key') return { 'X-API-Key': '<YOUR_API_KEY>' };
  return undefined;
}

function curlBody(doc: EndpointDoc): unknown | undefined {
  if (doc.slug === 'api/query') {
    return { nodes: [{ owner: 'octocat', name: 'Hello-World' }] };
  }
  return undefined;
}

function curlHasHeaders(doc: EndpointDoc): boolean {
  return doc.auth === 'X-API-Key';
}

function curlHasBody(doc: EndpointDoc): boolean {
  return doc.slug === 'api/query';
}

export function EndpointPage({ doc }: EndpointPageProps): ReactElement {
  return (
    <article className="ghc-doc-endpoint">
      <p className="ghc-section-eyebrow">Endpoint</p>
      <h1 className="ghc-doc-h1">
        <span className={`ghc-doc-method ghc-doc-method-${doc.method}`}>{doc.method}</span>{' '}
        <code className="ghc-doc-path">{doc.path}</code>
      </h1>
      <p className="ghc-doc-lede">{doc.summary}</p>
      <p className="ghc-doc-description">{doc.description}</p>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">Authentication</h2>
        <p>
          {doc.auth === 'none' ? (
            <>No authentication required. Public endpoint.</>
          ) : (
            <>Requires the <code>X-API-Key</code> header with an active API key.</>
          )}
        </p>
      </section>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">Rate limit</h2>
        <p><code>{doc.rateLimit}</code></p>
      </section>

      {doc.request && doc.request.length > 0 && (
        <section className="ghc-doc-section">
          <h2 className="ghc-doc-h2">Request</h2>
          <table className="ghc-doc-table">
            <thead>
              <tr><th>Name</th><th>In</th><th>Type</th><th>Required</th><th>Description</th></tr>
            </thead>
            <tbody>
              {doc.request.map((p) => (
                <tr key={p.name} className={p.required ? 'ghc-doc-table-row-required' : ''}>
                  <td><code>{p.name}</code></td>
                  <td><code>{p.in}</code></td>
                  <td><code>{p.type}</code></td>
                  <td>{p.required ? 'yes' : 'no'}</td>
                  <td>{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {doc.slug === 'api/query' && (
            <details>
              <summary>Body schema</summary>
              <SchemaViewer schema={queryBodySchema} />
            </details>
          )}
        </section>
      )}

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">Response</h2>
        <SchemaViewer schema={doc.response} />
      </section>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">Example response</h2>
        <ResponseExample sample={doc.responseSamples.default} />
      </section>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">Try it</h2>
        <CurlExample
          method={doc.method}
          url={buildUrl(doc)}
          {...(curlHasHeaders(doc) ? { headers: curlHeaders(doc)! } : {})}
          {...(curlHasBody(doc) ? { body: curlBody(doc) } : {})}
        />
      </section>

      {doc.headers && doc.headers.length > 0 && (
        <section className="ghc-doc-section">
          <h2 className="ghc-doc-h2">Response headers</h2>
          <HeadersTable headers={doc.headers} />
        </section>
      )}

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">Errors</h2>
        <ErrorsTable errors={doc.errors} />
      </section>
    </article>
  );
}
