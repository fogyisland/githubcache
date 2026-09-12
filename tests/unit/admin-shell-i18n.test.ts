import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const labels: Record<string, Record<string, string>> = {
      'admin.shell': {
        'sidebarAria': 'Admin sections',
        'breadcrumbAria': 'Breadcrumb',
        'sections.dashboard': 'Dashboard',
        'sections.users': 'Users',
        'sections.api-keys': 'API Keys',
        'sections.github-tokens': 'GitHub Tokens',
        'sections.reports': 'Reports',
        'sections.audit': 'Audit',
        'sections.refresh': 'Refresh',
        'sections.queue': 'Queue',
        'groups.overview.label': 'Overview',
        'groups.access.label': 'Access',
        'groups.data.label': 'Data',
        'groups.operations.label': 'Operations',
        'groups.system.label': 'System',
        'groupToggle.collapse': 'Collapse {group}',
        'groupToggle.expand': 'Expand {group}',
      },
      'admin.shell.dashboard': {
        title: 'Dashboard',
      },
    };
    return (key: string, vars?: Record<string, string | number>) => {
      const path = key;
      const v = labels[ns]?.[path];
      if (v && vars) {
        return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      }
      return v ?? key;
    };
  },
}));

// M30 — AdminSidebar is a client component that calls useTranslations
// from next-intl and usePathname from next/navigation. The test renders
// it server-side via renderToStaticMarkup, so both need deterministic
// stubs.
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
}));

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const labels: Record<string, Record<string, string>> = {
      'admin.shell': {
        sidebarAria: 'Admin sections',
        'sections.dashboard': 'Dashboard',
        'sections.users': 'Users',
        'sections.api-keys': 'API Keys',
        'sections.github-tokens': 'GitHub Tokens',
        'sections.reports': 'Reports',
        'sections.audit': 'Audit',
        'sections.refresh': 'Refresh',
        'sections.queue': 'Queue',
        'sections.queries': 'Queries',
        'sections.ingestion': 'Ingestion',
        'sections.providers': 'Providers',
        'sections.repositories': 'Imported nodes',
        'sections.webhooks': 'Webhooks',
        'sections.database': 'Database',
        'sections.api-settings': 'API Settings',
        'sections.insights': 'Insights',
        'sections.email': 'Email',
        'sections.email-log': 'Email log',
        'groups.overview.label': 'Overview',
        'groups.access.label': 'Access',
        'groups.data.label': 'Data',
        'groups.operations.label': 'Operations',
        'groups.system.label': 'System',
        'groupToggle.collapse': 'Collapse {group}',
        'groupToggle.expand': 'Expand {group}',
      },
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

import { AdminSidebar } from '@/app/admin/_components/admin-sidebar';

describe('AdminSidebar i18n', () => {
  it('renders translated section titles from messages', () => {
    const html = renderToStaticMarkup(
      createElement(AdminSidebar, { userRole: 'admin' }),
    );
    expect(html).toContain('Dashboard');
    expect(html).toContain('Users');
    expect(html).toContain('API Keys');
    expect(html).toContain('GitHub Tokens');
    expect(html).toContain('Reports');
    expect(html).toContain('Audit');
    expect(html).toContain('Refresh');
    expect(html).toContain('Queue');
  });

  it('hides admin-only sections for operator role', () => {
    const html = renderToStaticMarkup(
      createElement(AdminSidebar, { userRole: 'operator' }),
    );
    expect(html).toContain('Dashboard');
    expect(html).not.toContain('Users');  // admin-only
    expect(html).toContain('API Keys');
    expect(html).not.toContain('Audit');  // admin-only
  });
});