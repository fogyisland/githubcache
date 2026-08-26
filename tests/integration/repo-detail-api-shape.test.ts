import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Stub next/navigation so notFound() doesn't throw inside render.
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('__not_found__');
  },
}));

// Stable metadata payload so the JSON snapshot is deterministic.
const MOCK_METADATA = {
  id: 2325298,
  full_name: 'torvalds/linux',
  name: 'linux',
  owner: { login: 'torvalds', id: 1024025 },
  html_url: 'https://github.com/torvalds/linux',
  description: 'Linux kernel source tree',
  stargazers_count: 172934,
  language: 'C',
  default_branch: 'master',
};

vi.mock('@/lib/cache/lookup', () => ({
  lookupRepo: async () => ({
    canonical: 'torvalds/linux',
    original: 'torvalds/linux',
    found: true,
    fetch_status: 'ok',
    stale: false,
    last_fetched_at: new Date('2026-08-27T00:00:00Z'),
    metadata: MOCK_METADATA,
  }),
}));

import RepoDetailPage from '@/app/repo/[owner]/[name]/page';

describe('repo detail page — API shape section', () => {
  it('renders a collapsible <details> with the JSON metadata shape', async () => {
    const el = await RepoDetailPage({
      params: { owner: 'torvalds', name: 'linux' },
    });
    const html = renderToStaticMarkup(el as never);
    expect(html).toContain('ghc-api-shape');
    expect(html).toContain('<details');
    expect(html).toContain('&quot;full_name&quot;: &quot;torvalds/linux&quot;');
    expect(html).toContain('stargazers_count');
  });

  it('includes a /api/v1/repos/... link to fetch the same data via the public API', async () => {
    const el = await RepoDetailPage({
      params: { owner: 'torvalds', name: 'linux' },
    });
    const html = renderToStaticMarkup(el as never);
    expect(html).toContain('/api/v1/repos/torvalds/linux');
  });
});