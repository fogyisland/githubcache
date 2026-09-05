import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
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

// M24 — stub the new sub-components. They call resolveRequestTimezone →
// cookies(), which throws in the vitest render path (no request scope).
vi.mock('@/app/repo/[owner]/[name]/_components/fetch-history', () => ({
  FetchHistory: () => createElement('div', { 'data-testid': 'fetch-history-stub' }),
}));
vi.mock('@/app/repo/[owner]/[name]/_components/recent-queries', () => ({
  RecentQueries: () => createElement('div', { 'data-testid': 'recent-queries-stub' }),
}));
vi.mock('@/app/repo/[owner]/[name]/_components/releases-list', () => ({
  ReleasesList: () => createElement('div', { 'data-testid': 'releases-stub' }),
}));
vi.mock('@/app/repo/[owner]/[name]/_components/branches-list', () => ({
  BranchesList: () => createElement('div', { 'data-testid': 'branches-stub' }),
}));

// Mock next-intl/server — RepoDetailPage calls getTranslations inside
// the Vitest runtime, which lacks the Next.js server context next-intl
// requires. Mirrors the M13 admin-shell test mock pattern.
vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const labels: Record<string, Record<string, string>> = {
      'repo.hero': { backToAll: '← Back to all repositories' },
      'repo.apiShape': { eyebrow: 'API', hint: 'See {path} in {link}.' },
    };
    const t = (key: string, vars?: Record<string, string | number>) => {
      const v = labels[ns]?.[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
    // t.rich(key, chunks) — chunks values may be React elements
    // (e.g. `() => <code>{apiPath}</code>`). We invoke the chunk
    // function (if callable) then flatten the resulting React element to
    // a plain string for renderToStaticMarkup. Children may be string,
    // number, nested element, or array — recurse to leaf strings.
    const flatten = (node: unknown): string => {
      if (node == null || typeof node === 'boolean') return '';
      if (typeof node === 'string' || typeof node === 'number') return String(node);
      if (Array.isArray(node)) return node.map(flatten).join('');
      if (typeof node === 'object' && node !== null && 'props' in node) {
        const el = node as { props: { children?: unknown } };
        return flatten(el.props.children);
      }
      return '';
    };
    t.rich = (key: string, chunks: Record<string, React.ReactNode>) => {
      const v = labels[ns]?.[key] ?? key;
      return v.replace(/\{(\w+)\}/g, (_, k) => {
        const raw = chunks[k];
        const node = typeof raw === 'function' ? (raw as () => unknown)() : raw;
        return flatten(node);
      });
    };
    return t;
  },
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