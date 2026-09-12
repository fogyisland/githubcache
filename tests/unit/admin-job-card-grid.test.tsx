import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const labels: Record<string, Record<string, string>> = {
      'admin.queue': {
        emptyTitle: 'No pending jobs',
        emptyDescription:
          'The scheduler is up to date. Pending refresh jobs appear here when they are enqueued.',
      },
      'admin.queue.card': {
        status: 'Status',
        attempts: 'Attempts',
        enqueued: 'Enqueued',
        ageMin: '{min}m old',
        ageNow: 'just now',
        error: 'Last error',
      },
    };
    return (key: string, vars?: Record<string, string | number>) => {
      const v = labels[ns]?.[key] ?? `${ns}.${key}`;
      if (!vars) return v;
      return Object.entries(vars).reduce(
        (acc, [k, val]) => acc.replace(`{${k}}`, String(val)),
        v,
      );
    };
  },
}));

// AdminJobActionButton is a client component; stub it to a translated
// render so the SSR snapshot stays in this environment.
vi.mock('@/app/admin/_components/admin-job-action-button', () => ({
  AdminJobActionButton: ({ jobId, action }: { jobId: string; action: 'retry' | 'cancel' }) =>
    h('button', { type: 'button', className: `ghc-btn-${action}` }, action === 'retry' ? 'Retry' : 'Cancel'),
}));

import { AdminJobCard } from '@/app/admin/_components/admin-job-card';

const sampleJob = {
  id: 1n,
  repositoryId: 100n,
  status: 'pending',
  attempts: 0,
  createdAt: new Date('2026-09-11T11:55:00Z'),
  lastError: null,
  // M31 — owner/name live directly on the RefreshJob row.
  owner: 'vercel',
  name: 'next.js',
};

const failedJob = {
  id: 2n,
  repositoryId: 101n,
  status: 'failed',
  attempts: 3,
  createdAt: new Date('2026-09-11T10:00:00Z'),
  lastError: 'rate limited',
  owner: 'facebook',
  name: 'react',
};

describe('AdminJobCard', () => {
  it('renders the repo name, status chip, attempts, and enqueued timestamp', async () => {
    const html = renderToStaticMarkup(
      await AdminJobCard({ job: sampleJob, userTz: 'UTC' }),
    );
    expect(html).toContain('ghc-admin-job-card');
    expect(html).toContain('vercel/next.js');
    expect(html).toContain('ghc-admin-chip-info'); // pending
    expect(html).toContain('<dd>0</dd>'); // attempts
  });

  it('renders the failed chip + last-error block for failed jobs', async () => {
    const html = renderToStaticMarkup(
      await AdminJobCard({ job: failedJob, userTz: 'UTC' }),
    );
    expect(html).toContain('ghc-admin-chip-danger');
    expect(html).toContain('rate limited');
    expect(html).toContain('ghc-admin-job-card-error');
    expect(html).toContain('facebook/react');
  });

  it('renders retry and cancel action buttons', async () => {
    const html = renderToStaticMarkup(
      await AdminJobCard({ job: sampleJob, userTz: 'UTC' }),
    );
    expect(html).toContain('ghc-btn-retry');
    expect(html).toContain('ghc-btn-cancel');
  });
});
