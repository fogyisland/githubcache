import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/docs/api/v1-repos',
}));

import { EndpointPage } from '@/app/docs/_components/endpoint-page';
import { findEndpointBySlug } from '@/lib/api-docs/registry';

describe('EndpointPage', () => {
  it('renders method, path, summary, and sections', () => {
    const doc = findEndpointBySlug('api/v1-repos')!;
    const html = renderToStaticMarkup(createElement(EndpointPage, { doc }));
    expect(html).toContain('GET');
    expect(html).toContain('/api/v1/repos/{owner}/{name}');
    expect(html).toContain('Fetch a single repository');
    expect(html).toContain('Authentication');
    expect(html).toContain('Rate limit');
    expect(html).toContain('Request');
    expect(html).toContain('Response');
  });

  it('renders auth section with X-API-Key when required', () => {
    const doc = findEndpointBySlug('api/query')!;
    const html = renderToStaticMarkup(createElement(EndpointPage, { doc }));
    expect(html).toContain('X-API-Key');
  });
});
