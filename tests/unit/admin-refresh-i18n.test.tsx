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

const refreshDict = flattenDict({
  title: 'Manual refresh',
  description: 'Trigger a refresh for any repo, pause the scheduler, and watch the pending queue.',
  breadcrumb: { admin: 'Admin', refresh: 'Refresh' },
  trigger: {
    heading: 'Trigger manual refresh',
    repoLabel: 'Repository',
    selectPlaceholder: 'Select a repository…',
    repoOption: '#{id} — {owner}/{name}',
    submit: 'Trigger refresh',
    selectRepoError: 'Please select a repository.',
  },
  scheduler: {
    heading: 'Scheduler state',
    statusLabel: 'Status:',
    running: 'RUNNING',
    paused: 'PAUSED',
    pausedAt: 'Paused at: {timestamp}',
    multiProcessNote:
      'Note: pause is process-local. Multi-process deployments require DB-backed pause (out of scope per M5.5).',
    pause: 'Pause',
    resume: 'Resume',
  },
  pendingJobs: {
    heading: 'Pending refresh jobs (top 20)',
    empty: 'No pending jobs.',
    column: {
      jobId: 'Job ID',
      repository: 'Repository',
      priority: 'Priority',
      scheduled: 'Scheduled',
      attempts: 'Attempts',
    },
  },
});

function lookup(ns: string, key: string): string {
  const relPrefix = ns.startsWith('admin.refresh.') ? ns.slice('admin.refresh.'.length) : '';
  if (relPrefix) {
    const nested = `${relPrefix}.${key}`;
    const v = refreshDict[nested];
    if (v !== undefined) return v;
  }
  const full = ns + '.' + key;
  const fullV = refreshDict[full];
  if (fullV !== undefined) return fullV;
  const rootV = refreshDict[key];
  if (rootV !== undefined) return rootV;
  return key;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => (key: string, vars?: Record<string, string | number>) =>
    interpolate(lookup(ns, key), vars),
}));

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, string | number>) =>
    interpolate(lookup(ns, key), vars),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
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

vi.mock('@/lib/db/refresh-jobs', () => ({
  listPendingJobs: async () => [
    {
      id: 1n,
      repositoryId: 100n,
      priority: 10,
      scheduledFor: new Date('2026-08-28T10:00:00Z'),
      attempts: 0,
      lockedUntil: null,
      status: 'pending',
      lastError: null,
      createdAt: new Date('2026-08-28T09:00:00Z'),
      repository: {
        id: 100n,
        owner: 'vercel',
        name: 'next.js',
        installedAt: null,
        lastFetchedAt: null,
        lastEtag: null,
        status: 'active',
        createdAt: new Date('2026-08-01'),
      },
    },
  ],
  listRepositoriesForPicker: async () => [
    { id: 100n, owner: 'vercel', name: 'next.js' },
  ],
}));

vi.mock('@/lib/scheduler', () => ({
  isPaused: () => false,
  getPausedAt: () => null,
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

// RefreshControls is a client component that renders translated strings.
// We don't fully render it (it has click handlers, fetch); we stub it to a
// "translated render" that mirrors the strings produced by the real component,
// using the mocked translation lookup.
vi.mock('@/app/admin/refresh/_components/refresh-controls', () => ({
  RefreshControls: ({ isPaused, pausedAt, repos }: {
    isPaused: boolean;
    pausedAt: string | null;
    repos: Array<{ id: string; owner: string; name: string }>;
  }) => {
    const tTrig = (k: string, vars?: Record<string, string | number>) =>
      interpolate(lookup('admin.refresh.trigger', k), vars);
    const tSch = (k: string, vars?: Record<string, string | number>) =>
      interpolate(lookup('admin.refresh.scheduler', k), vars);
    return createElement(
      'div',
      { 'data-testid': 'refresh-controls-stub' },
      createElement('h2', null, tTrig('heading')),
      createElement('span', null, tTrig('repoLabel')),
      createElement(
        'select',
        { name: 'repoId' },
        createElement('option', { value: '' }, tTrig('selectPlaceholder')),
        ...repos.map((r) =>
          createElement(
            'option',
            { key: r.id, value: r.id },
            tTrig('repoOption', { id: r.id, owner: r.owner, name: r.name }),
          ),
        ),
      ),
      createElement('button', null, tTrig('submit')),
      createElement('h2', null, tSch('heading')),
      createElement(
        'div',
        null,
        tSch('statusLabel'),
        createElement('span', null, isPaused ? tSch('paused') : tSch('running')),
      ),
      pausedAt
        ? createElement('div', null, tSch('pausedAt', { timestamp: new Date(pausedAt).toISOString() }))
        : null,
      createElement('div', null, tSch('multiProcessNote')),
      createElement('button', null, isPaused ? tSch('resume') : tSch('pause')),
    );
  },
}));

// PendingJobsTable is an async server component — stub as a "translated render"
vi.mock('@/app/admin/refresh/_components/pending-jobs-table', () => ({
  PendingJobsTable: ({ jobs }: {
    jobs: Array<{
      id: string;
      repository: { owner: string; name: string };
    }>;
  }) => {
    const t = (k: string) => lookup('admin.refresh.pendingJobs', k);
    const tCol = (k: string) => lookup('admin.refresh.pendingJobs.column', k);
    return createElement(
      'div',
      { 'data-testid': 'pending-jobs-stub' },
      createElement('h2', null, t('heading')),
      jobs.length === 0
        ? createElement('p', null, t('empty'))
        : createElement(
            'table',
            null,
            createElement(
              'thead',
              null,
              createElement(
                'tr',
                null,
                createElement('th', null, tCol('jobId')),
                createElement('th', null, tCol('repository')),
                createElement('th', null, tCol('priority')),
                createElement('th', null, tCol('scheduled')),
                createElement('th', null, tCol('attempts')),
              ),
            ),
            createElement(
              'tbody',
              null,
              ...jobs.map((j) =>
                createElement(
                  'tr',
                  { key: j.id },
                  createElement('td', null, `#${j.id}`),
                  createElement('td', null, `${j.repository.owner}/${j.repository.name}`),
                ),
              ),
            ),
          ),
    );
  },
}));

import AdminRefreshPage from '@/app/admin/refresh/page';

describe('AdminRefreshPage i18n', () => {
  it('renders translated title and description on the page header', async () => {
    const html = renderToStaticMarkup(await AdminRefreshPage());
    expect(html).toContain('Manual refresh');
    expect(html).toContain(
      'Trigger a refresh for any repo, pause the scheduler, and watch the pending queue.'
    );
  });

  it('renders translated trigger heading, repo label, placeholder, options, submit', async () => {
    const html = renderToStaticMarkup(await AdminRefreshPage());
    // Heading + labels
    expect(html).toContain('Trigger manual refresh');
    expect(html).toContain('>Repository<');
    expect(html).toContain('Select a repository…');
    // Repo option with interpolation
    expect(html).toContain('#100 — vercel/next.js');
    // Submit button
    expect(html).toContain('Trigger refresh');
  });

  it('renders translated scheduler heading, status, RUNNING/PAUSED labels, and pause/resume button', async () => {
    const html = renderToStaticMarkup(await AdminRefreshPage());
    expect(html).toContain('Scheduler state');
    expect(html).toContain('Status:');
    expect(html).toContain('RUNNING');
    expect(html).toContain(
      'Note: pause is process-local. Multi-process deployments require DB-backed pause (out of scope per M5.5).'
    );
    // isPaused=false -> 'Pause' button
    expect(html).toContain('>Pause<');
  });

  it('renders translated pending jobs heading and column headers', async () => {
    const html = renderToStaticMarkup(await AdminRefreshPage());
    expect(html).toContain('Pending refresh jobs (top 20)');
    expect(html).toContain('>Job ID<');
    expect(html).toContain('>Repository<');
    expect(html).toContain('>Priority<');
    expect(html).toContain('>Scheduled<');
    expect(html).toContain('>Attempts<');
  });
});
