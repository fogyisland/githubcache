import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import type { EndpointDoc } from '@/lib/api-docs/types';
import { CurlExample } from './curl-example';
import { PythonExample } from './python-example';
import { JavaScriptExample } from './javascript-example';
import { SchemaViewer } from './schema-viewer';
import { ResponseExample } from './response-example';
import { HeadersTable } from './headers-table';
import { ErrorsTable } from './errors-table';
import { queryBodySchema } from '@/lib/api-docs/schemas/query';
import { slugToNs } from './_slug';
import { buildPython, buildJavaScript } from '@/lib/api-docs/build-examples';

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

export async function EndpointPage({ doc }: EndpointPageProps): Promise<ReactElement> {
  const t = await getTranslations('docs.endpointPage');
  const tReq = await getTranslations('docs.request');
  const tEp = await getTranslations(`docs.endpoint.${slugToNs(doc.slug)}` as const);
  // Pre-await tables so we can embed them in JSX (matches Task 2 SiteFooter pattern).
  const requestTable = doc.request && doc.request.length > 0 ? (
    <table className="ghc-doc-table">
      <thead>
        <tr>
          <th>{tReq('columns.name')}</th>
          <th>{tReq('columns.in')}</th>
          <th>{tReq('columns.type')}</th>
          <th>{tReq('columns.required')}</th>
          <th>{tReq('columns.description')}</th>
        </tr>
      </thead>
      <tbody>
        {doc.request.map((p) => (
          <tr key={p.name} className={p.required ? 'ghc-doc-table-row-required' : ''}>
            <td><code>{p.name}</code></td>
            <td><code>{p.in}</code></td>
            <td><code>{p.type}</code></td>
            <td>{p.required ? tReq('yes') : tReq('no')}</td>
            <td>
              {(() => {
                // Per-endpoint parameter description translations live at
                // docs.endpoint.<ns>.request.<name>-description.
                try {
                  return tEp(`request.${p.name}-description`);
                } catch {
                  return p.description;
                }
              })()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : null;

  const headersTable = doc.headers && doc.headers.length > 0
    ? await HeadersTable({ headers: doc.headers, endpointNs: slugToNs(doc.slug) })
    : null;

  const errorsTable = await ErrorsTable({ errors: doc.errors, endpointNs: slugToNs(doc.slug) });

  // Pre-await SchemaViewer (now async) before embedding in JSX.
  const responseSchema = await SchemaViewer({ schema: doc.response });
  const bodySchemaBlock = doc.slug === 'api/query'
    ? await SchemaViewer({ schema: queryBodySchema })
    : null;
  // Pre-await CurlExample (now async) before embedding in JSX.
  const curlExample = await CurlExample({
    method: doc.method,
    url: buildUrl(doc),
    ...(curlHasHeaders(doc) ? { headers: curlHeaders(doc)! } : {}),
    ...(curlHasBody(doc) ? { body: curlBody(doc) } : {}),
  });

  // M28.bug4e — generate Python and JavaScript examples for users who
  // don't want to translate from curl. Both come from the same source
  // data (path / method / request) so they stay in sync with the docs
  // schema automatically.
  const pythonCode = buildPython(doc);
  const jsCode = buildJavaScript(doc);

  return (
    <article className="ghc-doc-endpoint">
      <p className="ghc-section-eyebrow">{t('eyebrow')}</p>
      <h1 className="ghc-doc-h1">
        <span className={`ghc-doc-method ghc-doc-method-${doc.method}`}>{doc.method}</span>{' '}
        <code className="ghc-doc-path">{doc.path}</code>
      </h1>
      <p className="ghc-doc-lede">{tEp('summary')}</p>
      <p className="ghc-doc-description">{tEp('description')}</p>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('sections.authentication')}</h2>
        <p>
          {doc.auth === 'none' ? (
            t('auth.none')
          ) : (
            t.rich('auth.required', { header: (chunks) => <code>{chunks}</code> })
          )}
        </p>
      </section>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('sections.rateLimit')}</h2>
        <p><code>{tEp('rateLimit')}</code></p>
      </section>

      {requestTable && (
        <section className="ghc-doc-section">
          <h2 className="ghc-doc-h2">{t('sections.request')}</h2>
          {requestTable}
          {doc.slug === 'api/query' && bodySchemaBlock && (
            <details>
              <summary>{t('bodySchemaSummary')}</summary>
              {bodySchemaBlock}
            </details>
          )}
        </section>
      )}

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('sections.response')}</h2>
        {responseSchema}
      </section>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('sections.exampleResponse')}</h2>
        <ResponseExample sample={doc.responseSamples.default} />
      </section>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('sections.tryIt')}</h2>
        {curlExample}
      </section>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('sections.python')}</h2>
        <PythonExample code={pythonCode} filename={`${doc.slug.replace('/', '-')}.py`} />
      </section>

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('sections.javascript')}</h2>
        <JavaScriptExample code={jsCode} filename={`${doc.slug.replace('/', '-')}.js`} />
      </section>

      {headersTable && (
        <section className="ghc-doc-section">
          <h2 className="ghc-doc-h2">{t('sections.responseHeaders')}</h2>
          {headersTable}
        </section>
      )}

      <section className="ghc-doc-section">
        <h2 className="ghc-doc-h2">{t('sections.errors')}</h2>
        {errorsTable}
      </section>
    </article>
  );
}
