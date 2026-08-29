import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock('next-intl', () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}));

import { CurlExample } from '@/app/docs/_components/curl-example';
import { ResponseExample } from '@/app/docs/_components/response-example';
import { HeadersTable } from '@/app/docs/_components/headers-table';
import { ErrorsTable } from '@/app/docs/_components/errors-table';

describe('docs secondary components', () => {
  it('CurlExample renders the curl command in a code block with method class', async () => {
    const html = renderToStaticMarkup(
      await CurlExample({
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

  it('HeadersTable renders header rows', async () => {
    const html = renderToStaticMarkup(
      await HeadersTable({
        headers: [{ name: 'Retry-After', description: 'Seconds.', example: '30' }],
        endpointNs: 'api-query',
      }),
    );
    expect(html).toContain('Retry-After');
    expect(html).toContain('30');
  });

  it('ErrorsTable renders error rows', async () => {
    const html = renderToStaticMarkup(
      await ErrorsTable({
        errors: [{ status: 404, code: 'not_found', error: 'not_found', when: 'Repo not in cache.' }],
        endpointNs: 'api-v1-repos',
      }),
    );
    expect(html).toContain('404');
    expect(html).toContain('not_found');
  });
});
