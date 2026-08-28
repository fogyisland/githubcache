import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Mock next/navigation so DocsSidebar's usePathname() returns a value that
// matches the page under test. Each test imports a different page, so we
// re-mock per test.
vi.mock('next/navigation', () => ({
  usePathname: () => '/docs',
}));

import DocsLanding from '@/app/docs/page';
import V1StatusPage from '@/app/docs/api/v1-status/page';
import V1ReposPage from '@/app/docs/api/v1-repos/page';
import QueryPage from '@/app/docs/api/query/page';

describe('/docs routes render without error', () => {
  it('/docs renders the landing page with the API title and links to all three endpoint pages', async () => {
    const el = await DocsLanding();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('GitHub Metadata Cache API');
    expect(html).toContain('/docs/api/v1-status');
    expect(html).toContain('/docs/api/v1-repos');
    expect(html).toContain('/docs/api/query');
  });

  it('/docs/api/v1-status renders the GET endpoint with no-auth marker', async () => {
    const el = await V1StatusPage();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('GET');
    expect(html).toContain('/api/v1/status');
    expect(html).toContain('System status');
    expect(html).toContain('No authentication required');
  });

  it('/docs/api/v1-repos renders the GET endpoint with owner+name path params', async () => {
    const el = await V1ReposPage();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('GET');
    expect(html).toContain('/api/v1/repos/{owner}/{name}');
    expect(html).toContain('owner');
    expect(html).toContain('name');
    expect(html).toContain('No authentication required');
  });

  it('/docs/api/query renders the POST endpoint with X-API-Key auth and Retry-After header', async () => {
    const el = await QueryPage();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('POST');
    expect(html).toContain('/api/query');
    expect(html).toContain('X-API-Key');
    expect(html).toContain('Retry-After');
  });
});