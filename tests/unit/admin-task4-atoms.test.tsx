import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

const { adminFetchMock } = vi.hoisted(() => ({
  adminFetchMock: vi.fn(async () => ({ ok: true })),
}));

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const labels: Record<string, Record<string, string>> = {
      'admin.refresh.controls': {
        running: 'RUNNING',
        paused: 'PAUSED',
        pause: 'Pause',
        resume: 'Resume',
        pending: 'Working…',
      },
      'admin.githubTokens.test': {
        idle: 'Test',
        pending: 'Testing…',
        ok: 'OK',
        fail: 'Failed',
      },
      'admin.queue': {
        'retry.btn': 'Retry',
        'cancel.btn': 'Cancel',
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

vi.mock('@/lib/api/admin-fetch', () => ({
  adminFetch: adminFetchMock,
}));

afterEach(() => {
  adminFetchMock.mockReset();
});

import { AdminSchedulerControls } from '@/app/admin/_components/admin-scheduler-controls';
import { AdminTokenTestButton } from '@/app/admin/_components/admin-token-test-button';
import { AdminJobActionButton } from '@/app/admin/_components/admin-job-action-button';

describe('AdminSchedulerControls', () => {
  it('renders the running chip + Pause button when state is RUNNING', () => {
    const html = renderToStaticMarkup(h(AdminSchedulerControls, { currentState: 'RUNNING' }));
    expect(html).toContain('RUNNING');
    expect(html).toContain('Pause');
    expect(html).toContain('ghc-admin-chip-ok');
  });

  it('renders the paused chip + Resume button when state is PAUSED', () => {
    const html = renderToStaticMarkup(h(AdminSchedulerControls, { currentState: 'PAUSED' }));
    expect(html).toContain('PAUSED');
    expect(html).toContain('Resume');
    expect(html).toContain('ghc-admin-chip-warn');
  });
});

describe('AdminTokenTestButton', () => {
  it('renders an idle Test button on first render', () => {
    const html = renderToStaticMarkup(h(AdminTokenTestButton, { tokenId: '42' }));
    expect(html).toContain('Test');
    expect(html).toContain('ghc-btn-test-idle');
  });
});

describe('AdminJobActionButton', () => {
  it('renders a Retry button with the retry class', () => {
    const html = renderToStaticMarkup(h(AdminJobActionButton, { jobId: '7', action: 'retry' }));
    expect(html).toContain('Retry');
    expect(html).toContain('ghc-btn-retry');
  });

  it('renders a Cancel button with the cancel class', () => {
    const html = renderToStaticMarkup(h(AdminJobActionButton, { jobId: '7', action: 'cancel' }));
    expect(html).toContain('Cancel');
    expect(html).toContain('ghc-btn-cancel');
  });
});
