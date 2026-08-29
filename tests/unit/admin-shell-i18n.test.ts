import { describe, expect, it, vi } from 'vitest';
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

import { AdminSidebar } from '@/app/admin/_components/admin-sidebar';

describe('AdminSidebar i18n', () => {
  it('renders translated section titles from messages', async () => {
    const html = renderToStaticMarkup(
      await AdminSidebar({ current: 'dashboard', userRole: 'admin' }),
    );
    expect(html).toContain('Dashboard');
    expect(html).toContain('Users');
    expect(html).toContain('API Keys');
    expect(html).toContain('GitHub Tokens');
    expect(html).toContain('Reports');
    expect(html).toContain('Audit');
    expect(html).toContain('Refresh');
  });

  it('hides admin-only sections for operator role', async () => {
    const html = renderToStaticMarkup(
      await AdminSidebar({ current: 'dashboard', userRole: 'operator' }),
    );
    expect(html).toContain('Dashboard');
    expect(html).not.toContain('Users');  // admin-only
    expect(html).toContain('API Keys');
    expect(html).not.toContain('Audit');  // admin-only
  });
});
