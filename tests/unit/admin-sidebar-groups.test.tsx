import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminSidebar } from '@/app/admin/_components/admin-sidebar';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin'),
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
        'sections.queries': 'Queries',
        'sections.ingestion': 'Ingestion',
        'sections.providers': 'Providers',
        'sections.repositories': 'Imported nodes',
        'sections.audit': 'Audit',
        'sections.refresh': 'Refresh',
        'sections.queue': 'Queue',
        'sections.webhooks': 'Webhooks',
        'sections.database': 'Database',
        'sections.api-settings': 'API Settings',
        'sections.insights': 'Insights',
        'sections.email': 'Email',
        'sections.email-log': 'Email log',
      },
      'admin.shell.groups': {
        'overview.label': 'Overview',
        'access.label': 'Access',
        'data.label': 'Data',
        'operations.label': 'Operations',
        'system.label': 'System',
      },
      'admin.shell.groupToggle': {
        collapse: 'Collapse {group}',
        expand: 'Expand {group}',
      },
    };
    return (key: string, vars?: Record<string, string | number>) => {
      const v = labels[ns]?.[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
  },
}));

describe('AdminSidebar — groups (M30.8)', () => {
  beforeEach(async () => {
    const { usePathname } = await import('next/navigation');
    vi.mocked(usePathname).mockReturnValue('/admin');
  });

  it('renders all 5 group containers with data-group attributes', () => {
    const html = renderToStaticMarkup(<AdminSidebar userRole="admin" />);
    expect(html).toContain('data-group="overview"');
    expect(html).toContain('data-group="access"');
    expect(html).toContain('data-group="data"');
    expect(html).toContain('data-group="operations"');
    expect(html).toContain('data-group="system"');
  });

  it('renders group labels in render order', () => {
    const html = renderToStaticMarkup(<AdminSidebar userRole="admin" />);
    // Assert each label appears in the expected order.
    const overviewIdx = html.indexOf('Overview');
    const accessIdx = html.indexOf('Access');
    const dataIdx = html.indexOf('Data');
    const operationsIdx = html.indexOf('Operations');
    const systemIdx = html.indexOf('System');
    expect(overviewIdx).toBeGreaterThan(-1);
    expect(accessIdx).toBeGreaterThan(overviewIdx);
    expect(dataIdx).toBeGreaterThan(accessIdx);
    expect(operationsIdx).toBeGreaterThan(dataIdx);
    expect(systemIdx).toBeGreaterThan(operationsIdx);
  });

  it('hides admin-only groups from operators', () => {
    const html = renderToStaticMarkup(<AdminSidebar userRole="operator" />);
    // overview, access, data are operator-visible.
    expect(html).toContain('data-group="overview"');
    expect(html).toContain('data-group="access"');
    expect(html).toContain('data-group="data"');
    // operations and system are admin-only.
    expect(html).not.toContain('data-group="operations"');
    expect(html).not.toContain('data-group="system"');
  });

  it('hides admin-only sections within visible groups from operators', () => {
    const html = renderToStaticMarkup(<AdminSidebar userRole="operator" />);
    // `access` group is operator-visible but `users` is admin-only.
    expect(html).toContain('data-group="access"');
    expect(html).not.toContain('href="/admin/users"');
    // `data` group is operator-visible but `ingestion` and `providers` are admin-only.
    expect(html).toContain('data-group="data"');
    expect(html).not.toContain('href="/admin/ingestion"');
    expect(html).not.toContain('href="/admin/providers"');
  });

  it('renders each group\'s sections in the order declared by ADMIN_GROUPS', () => {
    const html = renderToStaticMarkup(<AdminSidebar userRole="admin" />);
    // Spot-check the `operations` group order: refresh, queue, webhooks, audit.
    const refreshIdx = html.indexOf('href="/admin/refresh"');
    const queueIdx = html.indexOf('href="/admin/queue"');
    const webhooksIdx = html.indexOf('href="/admin/webhooks"');
    const auditIdx = html.indexOf('href="/admin/audit"');
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(queueIdx).toBeGreaterThan(refreshIdx);
    expect(webhooksIdx).toBeGreaterThan(queueIdx);
    expect(auditIdx).toBeGreaterThan(webhooksIdx);
  });
});
