import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const labels: Record<string, Record<string, string>> = {
      'admin.shell': {
        sidebarAria: 'Admin sections',
        breadcrumbAria: 'Breadcrumb',
        'sections.dashboard': 'Dashboard',
        'sections.users': 'Users',
        'sections.api-keys': 'API Keys',
        'sections.github-tokens': 'GitHub Tokens',
        'sections.reports': 'Reports',
        'sections.audit': 'Audit',
        'sections.refresh': 'Refresh',
      },
    };
    return (key: string) => labels[ns]?.[key] ?? key;
  },
}));
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const labels: Record<string, Record<string, string>> = {
      'admin.shell.statusbar': { db: 'DB', ms: 'ms', queue: 'Queue', scheduler: 'Scheduler', audit24h: 'Audit 24h', operator: 'Operator' },
      'admin.shell.palette': { placeholder: 'Search admin — sections, recent actions…', noMatches: 'No matches for "{query}"', sections: 'Sections', recentAudit: 'Recent audit', hintNav: 'navigate', hintOpen: 'open', hintClose: 'close' },
    };
    return (key: string, vars?: Record<string, string | number>) => {
      const v = labels[ns]?.[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
  },
}));

import { AdminShell } from '@/app/admin/_components/admin-shell';
import type { AdminVariantId } from '@/lib/admin/variant';
import type { AdminModeId } from '@/lib/admin/mode';

const user = { email: 'op@example.com', role: 'operator' as const };
const initialStatus = {
  dbPingMs: 12,
  queueDepth: 3,
  schedulerState: 'RUNNING' as const,
  recentAuditCount: 7,
  user,
  variant: 'mission_control' as AdminVariantId,
  fetchedAt: '2026-08-27T12:00:00.000Z',
};

describe('AdminShell', () => {
  it('renders children inside the main content area', async () => {
    const html = renderToStaticMarkup(
      await AdminShell({
        current: 'dashboard',
        variant: 'mission_control',
        mode: 'dark' as AdminModeId,
        user,
        initialStatus,
        children: createElement('div', { 'data-testid': 'page' }, 'Hello page'),
      }),
    );
    expect(html).toContain('Hello page');
    expect(html).toContain('data-testid="page"');
  });

  it('renders sidebar with 7 sections', async () => {
    const html = renderToStaticMarkup(
      await AdminShell({
        current: 'dashboard',
        variant: 'mission_control',
        mode: 'dark' as AdminModeId,
        user: { email: 'a@b', role: 'admin' as const },
        initialStatus,
        children: createElement('span', null, 'x'),
      }),
    );
    expect(html).toContain('Dashboard');
    expect(html).toContain('Users');
    expect(html).toContain('API Keys');
    expect(html).toContain('GitHub Tokens');
    expect(html).toContain('Reports');
    expect(html).toContain('Audit');
    expect(html).toContain('Refresh');
  });

  it('marks the current section with an indicator', async () => {
    const html = renderToStaticMarkup(
      await AdminShell({
        current: 'users',
        variant: 'mission_control',
        mode: 'dark' as AdminModeId,
        user: { email: 'a@b', role: 'admin' as const },
        initialStatus,
        children: createElement('span', null, 'x'),
      }),
    );
    // current section gets ghc-admin-sidebar-current class
    expect(html).toContain('ghc-admin-sidebar-current');
    expect(html).toMatch(/ghc-admin-sidebar-current[^>]*href="\/admin\/users"/);
  });

  it('hides admin-only sections from operators', async () => {
    const html = renderToStaticMarkup(
      await AdminShell({
        current: 'dashboard',
        variant: 'mission_control',
        mode: 'dark' as AdminModeId,
        user, // role: operator
        initialStatus,
        children: createElement('span', null, 'x'),
      }),
    );
    expect(html).not.toContain('href="/admin/users"');
    expect(html).not.toContain('href="/admin/audit"');
    expect(html).not.toContain('href="/admin/refresh"');
    // operator-visible:
    expect(html).toContain('href="/admin/api-keys"');
    expect(html).toContain('href="/admin/reports"');
  });

  it('renders status bar only for mission_control variant', async () => {
    const mcHtml = renderToStaticMarkup(
      await AdminShell({
        current: 'dashboard',
        variant: 'mission_control',
        mode: 'dark' as AdminModeId,
        user,
        initialStatus,
        children: createElement('span', null, 'x'),
      }),
    );
    expect(mcHtml).toContain('ghc-admin-statusbar');

    const insHtml = renderToStaticMarkup(
      await AdminShell({
        current: 'dashboard',
        variant: 'inspector',
        mode: 'dark' as AdminModeId,
        user,
        initialStatus,
        children: createElement('span', null, 'x'),
      }),
    );
    expect(insHtml).not.toContain('ghc-admin-statusbar');

    const wbHtml = renderToStaticMarkup(
      await AdminShell({
        current: 'dashboard',
        variant: 'workbench',
        mode: 'dark' as AdminModeId,
        user,
        initialStatus,
        children: createElement('span', null, 'x'),
      }),
    );
    expect(wbHtml).not.toContain('ghc-admin-statusbar');
  });

  // M26.x — the shell passes the active color mode to the wrapper so the
  // [data-admin-mode="..."] CSS scope can paint the right palette.
  it('emits data-admin-mode="dark" by default', async () => {
    const html = renderToStaticMarkup(
      await AdminShell({
        current: 'dashboard',
        variant: 'mission_control',
        mode: 'dark' as AdminModeId,
        user,
        initialStatus,
        children: createElement('span', null, 'x'),
      }),
    );
    expect(html).toMatch(/data-admin-mode="dark"/);
  });

  it('emits data-admin-mode="light" when mode=light', async () => {
    const html = renderToStaticMarkup(
      await AdminShell({
        current: 'dashboard',
        variant: 'inspector',
        mode: 'light' as AdminModeId,
        user,
        initialStatus,
        children: createElement('span', null, 'x'),
      }),
    );
    expect(html).toMatch(/data-admin-mode="light"/);
  });
});