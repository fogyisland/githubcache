import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

function flattenDict(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix === '' ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenDict(v as Record<string, unknown>, path));
    } else {
      out[path] = String(v);
    }
  }
  return out;
}

const queriesDict = flattenDict({
  title: 'Queries',
  description:
    'Drill-down on consumer API traffic: time window, top repos, top keys, and a paginated list of recent requests (including anonymous v1 calls).',
  breadcrumb: { admin: 'Admin', queries: 'Queries' },
  dateRange: {
    from: 'From',
    to: 'To',
    apply: 'Apply',
    reset: 'Reset',
  },
  kpi: {
    totalRequests: 'Total requests',
    cacheHitRate: 'Cache hit rate',
    avgLatency: 'Avg latency',
    activeApiKeys: 'Active API keys',
  },
  topRepos: {
    heading: 'Top queried repositories',
    empty: 'No requests in this window.',
    column: { repo: 'Repository', requests: 'Requests', hitRate: 'Hit rate' },
  },
  topKeys: {
    heading: 'Top API keys',
    empty: 'No requests in this window.',
    column: { label: 'Label', requests: 'Requests', lastUsed: 'Last used' },
    dash: '—',
  },
  recent: {
    heading: 'Recent requests',
    empty: 'No requests in this window.',
    anonymous: 'anonymous',
    hit: 'hit',
    miss: 'miss',
    dash: '—',
    column: {
      when: 'When',
      endpoint: 'Endpoint',
      key: 'Key',
      repo: 'Repo',
      cache: 'Cache',
      latency: 'Latency',
      status: 'Status',
    },
  },
});

function lookup(ns: string, key: string): string {
  const relPrefix = ns.startsWith('admin.queries.') ? ns.slice('admin.queries.'.length) : '';
  if (relPrefix) {
    const nested = `${relPrefix}.${key}`;
    const v = queriesDict[nested];
    if (v !== undefined) return v;
  }
  const full = ns + '.' + key;
  const fullV = queriesDict[full];
  if (fullV !== undefined) return fullV;
  const rootV = queriesDict[key];
  if (rootV !== undefined) return rootV;
  return key;
}

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => (key: string) => lookup(ns, key),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
}));

vi.mock('@/lib/auth/session', () => ({
  validateSession: async () => ({
    id: 1n,
    email: 'admin@test.com',
    role: 'admin',
    status: 'active',
    adminVariant: 'mission_control',
    theme: 'terminal',
    createdAt: new Date('2026-01-01'),
    lastLoginAt: null,
    passwordHash: '',
  }),
}));

vi.mock('@/lib/reports/queries', () => ({
  totalRequests: async () => 4321,
  cacheHitRate: async () => 0.78,
  avgLatency: async () => 33,
  activeApiKeyCount: async () => 5,
  topRepos: async () => [
    { repo: 'vercel/next.js', requestCount: 200, hitRate: 0.9 },
  ],
  topKeys: async () => [
    { keyId: 1n, label: 'ci-key-1', requestCount: 150, lastUsed: new Date('2026-08-28T09:00:00Z') },
  ],
  recentRequests: async () => ({
    rows: [
      {
        id: 10n,
        createdAt: new Date('2026-08-28T10:00:00Z'),
        endpoint: '/api/query',
        keyId: 1n,
        keyName: 'ci-key-1',
        repoRequested: 'vercel/next.js',
        cacheHit: true,
        durationMs: 22,
        statusCode: 200,
        ip: '10.0.0.1',
      },
      {
        id: 11n,
        createdAt: new Date('2026-08-28T10:01:00Z'),
        endpoint: '/api/v1/repos/[owner]/[name]',
        keyId: null,
        keyName: null,
        repoRequested: 'anon/repo',
        cacheHit: true,
        durationMs: 18,
        statusCode: 200,
        ip: '10.0.0.2',
      },
    ],
    total: 2,
  }),
}));

vi.mock('@/app/admin/_components/admin-page-header', () => ({
  AdminPageHeader: ({ title, description }: { title: string; description?: string }) =>
    createElement(
      'div',
      { 'data-testid': 'page-header-stub' },
      createElement('h1', null, title),
      description ? createElement('p', null, description) : null,
    ),
}));

vi.mock('@/app/admin/_components/admin-pagination', () => ({
  AdminPagination: () => createElement('div', { 'data-testid': 'pagination-stub' }),
}));

// Mock async server sub-components — renderToStaticMarkup can't handle real async components.
vi.mock('@/app/admin/queries/_components/queries-kpis', () => ({
  QueriesKpis: ({ totalRequests, cacheHitRate, avgLatencyMs, activeApiKeys }: {
    totalRequests: number;
    cacheHitRate: number;
    avgLatencyMs: number;
    activeApiKeys: number;
  }) => createElement(
    'div',
    { 'data-testid': 'queries-kpis-stub' },
    createElement('span', { 'data-field': 'totalRequests' }, String(totalRequests)),
    createElement('span', { 'data-field': 'cacheHitRate' }, String(cacheHitRate)),
    createElement('span', { 'data-field': 'avgLatencyMs' }, String(avgLatencyMs)),
    createElement('span', { 'data-field': 'activeApiKeys' }, String(activeApiKeys)),
  ),
}));

vi.mock('@/app/admin/queries/_components/queries-date-range', () => ({
  QueriesDateRange: () => createElement('div', { 'data-testid': 'date-range-stub' }),
}));

vi.mock('@/app/admin/queries/_components/top-queried-repos', () => ({
  TopQueriedReposTable: () => createElement('div', { 'data-testid': 'top-repos-stub' }),
}));

vi.mock('@/app/admin/queries/_components/top-keys-table', () => ({
  TopKeysTable: () => createElement('div', { 'data-testid': 'top-keys-stub' }),
}));

vi.mock('@/app/admin/queries/_components/recent-requests-table', () => ({
  RecentRequestsTable: ({ rows }: { rows: Array<{ endpoint: string; keyName: string | null; repoRequested: string | null; cacheHit: boolean; durationMs: number; statusCode: number }> }) =>
    createElement(
      'div',
      { 'data-testid': 'recent-requests-stub' },
      ...rows.map((r) =>
        createElement(
          'div',
          { 'data-row': r.endpoint },
          createElement('span', null, r.endpoint),
          createElement('span', null, r.keyName ?? 'anonymous'),
          createElement('span', null, r.repoRequested ?? '—'),
          createElement('span', null, r.cacheHit ? 'hit' : 'miss'),
          createElement('span', null, `${r.durationMs} ms`),
          createElement('span', null, String(r.statusCode)),
        ),
      ),
    ),
}));

import AdminQueriesPage from '@/app/admin/queries/page';

describe('AdminQueriesPage i18n', () => {
  it('renders translated title and description on the page header', async () => {
    const html = renderToStaticMarkup(await AdminQueriesPage({ searchParams: {} }));
    expect(html).toContain('Queries');
    expect(html).toContain(
      'Drill-down on consumer API traffic: time window, top repos, top keys, and a paginated list of recent requests (including anonymous v1 calls).',
    );
  });

  it('passes real aggregation values to the KPIs stub', async () => {
    const html = renderToStaticMarkup(await AdminQueriesPage({ searchParams: {} }));
    expect(html).toContain('data-field="totalRequests"');
    expect(html).toContain('data-field="cacheHitRate"');
    expect(html).toContain('>4321<');
    expect(html).toContain('>5<');
  });

  it('renders anonymous v1 rows with the anonymous key label', async () => {
    const html = renderToStaticMarkup(await AdminQueriesPage({ searchParams: {} }));
    expect(html).toContain('/api/v1/repos/[owner]/[name]');
    expect(html).toContain('anonymous');
  });
});