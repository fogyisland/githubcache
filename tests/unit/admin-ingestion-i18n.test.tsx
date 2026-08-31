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

const ingestionDict = flattenDict({
  title: 'Ingestion',
  description:
    'GitHub→DB pipeline health: queue depth, throughput, cached-repo fetch status, and recent refresh jobs.',
  breadcrumb: { admin: 'Admin', ingestion: 'Ingestion' },
  kpi: {
    pending: 'Pending jobs',
    inProgress: 'In progress',
    done: 'Done (1h)',
    failed: 'Failed (1h)',
  },
  breakdown: {
    heading: 'Cached-repo fetch status',
    empty: 'No repositories cached.',
    ok: 'ok',
    notFound: 'not_found',
    forbidden: 'forbidden',
    error: 'error',
  },
  scheduler: {
    label: 'Scheduler:',
    running: 'RUNNING',
    paused: 'PAUSED',
    pausedAt: 'paused at {when}',
    manageLink: 'Manage scheduler →',
  },
  recent: {
    heading: 'Recent refresh jobs',
    empty: 'No refresh jobs yet.',
    dash: '—',
    status: {
      pending: 'pending',
      in_progress: 'in progress',
      done: 'done',
      failed: 'failed',
    },
    column: {
      when: 'When',
      repo: 'Repo',
      status: 'Status',
      priority: 'Priority',
      attempts: 'Attempts',
      error: 'Last error',
    },
  },
});

function lookup(ns: string, key: string): string {
  const relPrefix = ns.startsWith('admin.ingestion.') ? ns.slice('admin.ingestion.'.length) : '';
  if (relPrefix) {
    const nested = `${relPrefix}.${key}`;
    const v = ingestionDict[nested];
    if (v !== undefined) return v;
  }
  const full = ns + '.' + key;
  const fullV = ingestionDict[full];
  if (fullV !== undefined) return fullV;
  const rootV = ingestionDict[key];
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

vi.mock('@/lib/scheduler', () => ({
  isPaused: () => false,
  getPausedAt: () => null,
}));

vi.mock('@/lib/reports/ingestion', () => ({
  ingestionSummary: async () => ({ pending: 4, inProgress: 1, done: 12, failed: 2 }),
  repositoryFetchBreakdown: async () => ({ ok: 100, not_found: 5, forbidden: 1, error: 3 }),
  recentRefreshJobs: async () => [
    {
      id: 100n,
      repositoryId: 1n,
      repositoryOwner: 'vercel',
      repositoryName: 'next.js',
      status: 'done',
      priority: 50,
      attempts: 1,
      lastError: null,
      createdAt: new Date('2026-08-28T10:00:00Z'),
      updatedAt: new Date('2026-08-28T10:00:05Z'),
      total: 1,
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

vi.mock('@/app/admin/_components/admin-pagination', () => ({
  AdminPagination: () => createElement('div', { 'data-testid': 'pagination-stub' }),
}));

vi.mock('@/app/admin/_components/admin-status-chip', () => ({
  AdminStatusChip: ({ children }: { children: unknown }) =>
    createElement('span', { 'data-testid': 'chip-stub' }, children as never),
}));

// Mock async server sub-components — renderToStaticMarkup can't handle real async components.
vi.mock('@/app/admin/ingestion/_components/ingestion-kpis', () => ({
  IngestionKpis: ({ pending, inProgress, done, failed }: {
    pending: number; inProgress: number; done: number; failed: number;
  }) => createElement(
    'div',
    { 'data-testid': 'ingestion-kpis-stub' },
    createElement('span', { 'data-field': 'pending' }, String(pending)),
    createElement('span', { 'data-field': 'inProgress' }, String(inProgress)),
    createElement('span', { 'data-field': 'done' }, String(done)),
    createElement('span', { 'data-field': 'failed' }, String(failed)),
  ),
}));

vi.mock('@/app/admin/ingestion/_components/fetch-status-breakdown', () => ({
  FetchStatusBreakdown: ({ ok, not_found, forbidden, error }: {
    ok: number; not_found: number; forbidden: number; error: number;
  }) => createElement(
    'div',
    { 'data-testid': 'breakdown-stub' },
    createElement('span', { 'data-field': 'ok' }, String(ok)),
    createElement('span', { 'data-field': 'notFound' }, String(not_found)),
    createElement('span', { 'data-field': 'forbidden' }, String(forbidden)),
    createElement('span', { 'data-field': 'error' }, String(error)),
  ),
}));

vi.mock('@/app/admin/ingestion/_components/scheduler-state-card', () => ({
  SchedulerStateCard: ({ isPaused }: { isPaused: boolean; pausedAt: Date | null }) =>
    createElement(
      'div',
      { 'data-testid': 'scheduler-card-stub', 'data-paused': String(isPaused) },
    ),
}));

vi.mock('@/app/admin/ingestion/_components/recent-jobs-table', () => ({
  RecentJobsTable: ({ rows }: { rows: Array<{ status: string; repositoryOwner: string; repositoryName: string }> }) =>
    createElement(
      'div',
      { 'data-testid': 'recent-jobs-stub' },
      ...rows.map((r) =>
        createElement(
          'div',
          { 'data-row': `${r.repositoryOwner}/${r.repositoryName}` },
          createElement('span', null, `${r.repositoryOwner}/${r.repositoryName}`),
          createElement('span', null, r.status),
        ),
      ),
    ),
}));

vi.mock('@/app/admin/ingestion/_components/run-via-provider', () => ({
  RunViaProvider: () =>
    createElement('div', { 'data-testid': 'run-via-provider-stub' }),
}));

import AdminIngestionPage from '@/app/admin/ingestion/page';

describe('AdminIngestionPage i18n', () => {
  it('renders translated title and description on the page header', async () => {
    const html = renderToStaticMarkup(await AdminIngestionPage({ searchParams: {} }));
    expect(html).toContain('Ingestion');
    expect(html).toContain(
      'GitHub→DB pipeline health: queue depth, throughput, cached-repo fetch status, and recent refresh jobs.',
    );
  });

  it('passes real aggregation values to KPI + breakdown stubs', async () => {
    const html = renderToStaticMarkup(await AdminIngestionPage({ searchParams: {} }));
    expect(html).toContain('data-field="pending"');
    expect(html).toContain('data-field="done"');
    expect(html).toContain('>4<');
    expect(html).toContain('>12<');
    expect(html).toContain('data-field="ok"');
    expect(html).toContain('>100<');
  });

  it('shows the scheduler card and the recent-jobs table together', async () => {
    const html = renderToStaticMarkup(await AdminIngestionPage({ searchParams: {} }));
    expect(html).toContain('data-testid="scheduler-card-stub"');
    expect(html).toContain('data-testid="recent-jobs-stub"');
    expect(html).toContain('vercel/next.js');
  });
});