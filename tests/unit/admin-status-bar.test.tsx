import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AdminStatusBar } from '@/app/admin/_components/admin-status-bar';

const baseData = {
  dbPingMs: 12,
  queueDepth: 3,
  schedulerState: 'RUNNING' as const,
  recentAuditCount: 7,
  user: { email: 'op@example.com', role: 'operator' as const },
  variant: 'mission_control' as const,
  fetchedAt: '2026-08-27T12:00:00.000Z',
};

describe('AdminStatusBar', () => {
  it('renders all 4 columns from initial data', () => {
    const html = renderToStaticMarkup(createElement(AdminStatusBar, { initialData: baseData }));
    expect(html).toContain('DB');
    expect(html).toContain('12 ms');
    expect(html).toContain('Queue');
    expect(html).toContain('3');
    expect(html).toContain('Scheduler');
    expect(html).toContain('RUNNING');
    expect(html).toContain('Audit');
    expect(html).toContain('7');
  });

  it('shows operator email + role', () => {
    const html = renderToStaticMarkup(createElement(AdminStatusBar, { initialData: baseData }));
    expect(html).toContain('op@example.com');
    expect(html).toContain('operator');
  });

  it('shows variant badge', () => {
    const html = renderToStaticMarkup(createElement(AdminStatusBar, { initialData: baseData }));
    expect(html).toContain('mission_control');
  });

  it('renders PAUSED state in a warn-styled column', () => {
    const html = renderToStaticMarkup(
      createElement(AdminStatusBar, {
        initialData: { ...baseData, schedulerState: 'PAUSED' as const },
      }),
    );
    expect(html).toContain('PAUSED');
    expect(html).toContain('ghc-admin-statusbar-tone-warn');
  });
});