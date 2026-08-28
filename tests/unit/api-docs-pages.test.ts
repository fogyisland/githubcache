import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/docs/api/v1-repos',
}));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async (ns: string) => {
    const dict: Record<string, string> = {
      'docs.endpointPage.sections.authentication': 'Authentication',
      'docs.endpointPage.sections.rateLimit': 'Rate limit',
      'docs.endpointPage.sections.request': 'Request',
      'docs.endpointPage.sections.response': 'Response',
      'docs.endpointPage.auth.none': 'No authentication required. Public endpoint.',
      'docs.endpointPage.auth.required': 'Requires the {header} header with an active API key.',
      'docs.endpoint.api-v1-repos.summary': 'Fetch a single repository metadata record from the cache.',
      'docs.endpoint.api-v1-repos.description': 'Public read of the cache for a single repo.',
      'docs.endpoint.api-v1-repos.rateLimit': 'PUBLIC_LOOKUP_RATE_PER_MIN (default 30) per IP',
      'docs.endpoint.api-query.summary': 'Batch-fetch up to 50 repositories with a single API key.',
      'docs.endpoint.api-query.description': 'Authenticated batch endpoint for API key holders.',
      'docs.endpoint.api-query.rateLimit': 'rateLimitPerMin (per API key, default 60) durable bucket',
      'docs.endpoint.api-v1-status.summary': 'System status — DB, token pool, queue, repository counts, version.',
      'docs.endpoint.api-v1-status.description': 'Read-only observability endpoint. Always public, no rate limit.',
      'docs.endpoint.api-v1-status.rateLimit': 'No rate limit.',
    };
    const t = ((key: string) => dict[`${ns}.${key}`] ?? key) as ((key: string) => string) & {
      rich: (key: string, values: Record<string, string | ((chunks: ReactNode) => ReactNode)>) => ReactNode;
    };
    t.rich = (key: string, values: Record<string, string | ((chunks: ReactNode) => ReactNode)>): ReactNode => {
      const headerFn = values.header;
      const headerChunk = typeof headerFn === 'function' ? headerFn('X-API-Key') : headerFn;
      return createElement('span', null, 'Requires the ', headerChunk, ' header with an active API key.');
    };
    return t;
  }),
}));
vi.mock('next-intl', () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}));

import { EndpointPage } from '@/app/docs/_components/endpoint-page';
import { findEndpointBySlug } from '@/lib/api-docs/registry';

describe('EndpointPage', () => {
  it('renders method, path, summary, and sections', async () => {
    const doc = findEndpointBySlug('api/v1-repos')!;
    const html = renderToStaticMarkup(await EndpointPage({ doc }));
    expect(html).toContain('GET');
    expect(html).toContain('/api/v1/repos/{owner}/{name}');
    expect(html).toContain('Fetch a single repository');
    expect(html).toContain('Authentication');
    expect(html).toContain('Rate limit');
    expect(html).toContain('Request');
    expect(html).toContain('Response');
  });

  it('renders auth section with X-API-Key when required', async () => {
    const doc = findEndpointBySlug('api/query')!;
    const html = renderToStaticMarkup(await EndpointPage({ doc }));
    expect(html).toContain('X-API-Key');
  });
});
