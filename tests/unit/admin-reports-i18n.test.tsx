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

const reportsDict = flattenDict({
  title: 'Reports',
  description: 'Aggregated usage, cache performance, and quota over the last 24 hours.',
  breadcrumb: { admin: 'Admin', reports: 'Reports' },
  kpi: {
    totalRequests: 'Total requests',
    cacheHitRate: 'Cache hit rate',
    avgLatency: 'Avg latency',
    activeApiKeys: 'Active API keys',
  },
  chart: {
    heading: 'Requests over time (24h, hourly)',
    empty: 'No data in this window.',
    cacheHits: 'Cache hits',
    cacheMisses: 'Cache misses',
  },
  topRepos: {
    heading: 'Top repositories',
    empty: 'No requests in this window.',
    column: { repo: 'Repository', requests: 'Requests', hitRate: 'Hit rate' },
  },
  topKeys: {
    heading: 'Top API keys',
    empty: 'No requests in this window.',
    column: { label: 'Label', requests: 'Requests', lastUsed: 'Last used' },
    dash: '—',
  },
  tokenQuota: {
    heading: 'Token quota usage',
    empty: 'No tokens registered.',
    column: {
      label: 'Label',
      status: 'Status',
      used: 'Used',
      limit: 'Limit',
      usedPct: 'Used %',
      resets: 'Resets',
    },
    dash: '—',
    status: { active: 'active', disabled: 'disabled' },
  },
});

// Key resolution: namespace "admin.reports" stores keys like "title", "breadcrumb.admin", etc.
// Namespaced calls like "admin.reports.kpi" + key "totalRequests" should resolve to "kpi.totalRequests".
// Provide a flat lookup that joins the namespace prefix and key.
function lookup(ns: string, key: string): string {
  // Strip the leading "admin.reports." from the ns to get the relative prefix
  const relPrefix = ns.startsWith('admin.reports.') ? ns.slice('admin.reports.'.length) : '';
  // Try nested prefix + key first (e.g. kpi + totalRequests)
  if (relPrefix) {
    const nested = `${relPrefix}.${key}`;
    const v = reportsDict[nested];
    if (v !== undefined) return v;
  }
  // Then try with full path: admin.reports.kpi.totalRequests
  const full = ns + '.' + key;
  const fullV = reportsDict[full];
  if (fullV !== undefined) return fullV;
  // Try relative to admin.reports root
  const rootV = reportsDict[key];
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
  totalRequests: async () => 1234,
  cacheHitRate: async () => 0.85,
  avgLatency: async () => 42,
  activeApiKeyCount: async () => 7,
  requestsOverTime: async () => [
    { hour: new Date('2026-08-28T10:00:00Z'), cacheHits: 80, cacheMisses: 20 },
  ],
  topRepos: async () => [
    { repo: 'vercel/next.js', requestCount: 500, hitRate: 0.9 },
  ],
  topKeys: async () => [
    { keyId: 1n, label: 'ci-key-1', requestCount: 300, lastUsed: new Date('2026-08-28T09:00:00Z') },
  ],
  tokenQuotaUsage: async () => [
    {
      id: 1n,
      label: 'ci-token-1',
      status: 'active',
      requestsUsed: 100,
      requestsLimit: 5000,
      resetAt: null,
    },
  ],
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

// Mock async server sub-components — renderToStaticMarkup can't handle real async components.
vi.mock('@/app/admin/reports/_components/kpi-cards', () => ({
  KpiCards: ({ totalRequests, cacheHitRate, avgLatencyMs, activeApiKeys }: {
    totalRequests: number;
    cacheHitRate: number;
    avgLatencyMs: number;
    activeApiKeys: number;
  }) => createElement(
    'div',
    { 'data-testid': 'kpi-cards-stub' },
    createElement('span', { 'data-field': 'totalRequests' }, String(totalRequests)),
    createElement('span', { 'data-field': 'cacheHitRate' }, String(cacheHitRate)),
    createElement('span', { 'data-field': 'avgLatencyMs' }, String(avgLatencyMs)),
    createElement('span', { 'data-field': 'activeApiKeys' }, String(activeApiKeys)),
  ),
}));

vi.mock('@/app/admin/reports/_components/requests-over-time-chart', () => ({
  RequestsOverTimeChart: () => createElement('div', { 'data-testid': 'chart-stub' }),
}));

vi.mock('@/app/admin/reports/_components/top-repos-table', () => ({
  TopReposTable: () => createElement('div', { 'data-testid': 'top-repos-stub' }),
}));

vi.mock('@/app/admin/reports/_components/top-keys-table', () => ({
  TopKeysTable: () => createElement('div', { 'data-testid': 'top-keys-stub' }),
}));

vi.mock('@/app/admin/reports/_components/token-quota-table', () => ({
  TokenQuotaTable: () => createElement('div', { 'data-testid': 'token-quota-stub' }),
}));

import AdminReportsPage from '@/app/admin/reports/page';

describe('AdminReportsPage i18n', () => {
  it('renders translated title and description on the page header', async () => {
    const html = renderToStaticMarkup(await AdminReportsPage());
    expect(html).toContain('Reports');
    expect(html).toContain(
      'Aggregated usage, cache performance, and quota over the last 24 hours.'
    );
    // KPI values are passed through stubs
    expect(html).toContain('1234');
    expect(html).toContain('0.85');
  });

  it('passes real values to KpiCards stub (server/client boundary intact)', async () => {
    const html = renderToStaticMarkup(await AdminReportsPage());
    expect(html).toContain('data-field="totalRequests"');
    expect(html).toContain('data-field="activeApiKeys"');
    expect(html).toContain('>7<');
    expect(html).toContain('>1234<');
  });
});
