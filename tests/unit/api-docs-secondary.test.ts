import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CurlExample } from '@/app/docs/_components/curl-example';
import { ResponseExample } from '@/app/docs/_components/response-example';
import { HeadersTable } from '@/app/docs/_components/headers-table';
import { ErrorsTable } from '@/app/docs/_components/errors-table';

describe('docs secondary components', () => {
  it('CurlExample renders the curl command in a code block with method class', () => {
    const html = renderToStaticMarkup(
      createElement(CurlExample, {
        method: 'GET',
        url: 'https://api.example.com/api/v1/status',
      }),
    );
    expect(html).toContain('curl');
    expect(html).toContain('ghc-doc-method-GET');
    expect(html).toContain('ghc-doc-code-block');
  });

  it('ResponseExample renders JSON with key highlighting', () => {
    const html = renderToStaticMarkup(
      createElement(ResponseExample, { sample: { ok: true, count: 5 } }),
    );
    expect(html).toContain('ghc-json-key');
    expect(html).toContain('"ok"');
    expect(html).toContain('5');
  });

  it('HeadersTable renders header rows', () => {
    const html = renderToStaticMarkup(
      createElement(HeadersTable, {
        headers: [{ name: 'Retry-After', description: 'Seconds.', example: '30' }],
      }),
    );
    expect(html).toContain('Retry-After');
    expect(html).toContain('30');
  });

  it('ErrorsTable renders error rows', () => {
    const html = renderToStaticMarkup(
      createElement(ErrorsTable, {
        errors: [{ status: 404, error: 'not_found', when: 'Repo not in cache.' }],
      }),
    );
    expect(html).toContain('404');
    expect(html).toContain('not_found');
  });
});
