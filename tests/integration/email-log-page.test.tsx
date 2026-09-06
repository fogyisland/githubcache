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

const adminShellDict = flattenDict({
  sidebarAria: 'Admin sections',
  breadcrumbAria: 'Breadcrumb',
  role: { admin: 'admin', operator: 'operator' },
  sections: {
    dashboard: 'Dashboard',
    email: 'Email',
    'email-log': 'Email log',
  },
});

const emailLogDict = flattenDict({
  title: 'Email log',
  description: 'desc',
  breadcrumbAdmin: 'Admin',
  breadcrumbEmail: 'Email',
  breadcrumbLog: 'Log',
  filter: {
    status: 'Status',
    templateKey: 'Template',
    anyOption: '(any)',
  },
  column: {
    when: 'When',
    recipient: 'Recipient',
    templateKey: 'Template',
    subject: 'Subject',
    status: 'Status',
    error: 'Error',
  },
  status: { queued: 'queued', sent: 'sent', failed: 'failed' },
  templateKey: {
    invite: 'Invite',
    'password-reset': 'Password reset',
    'api-key-approved': 'API key approved',
    'daily-report': 'Daily report',
    'weekly-report': 'Weekly report',
    test: 'Test send',
  },
  empty: 'No email log entries match these filters.',
  errorDash: '—',
});

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const dicts: Record<string, Record<string, string>> = {
      'admin.shell': adminShellDict,
      'admin.common.pagination': flattenDict({
        showing: 'Showing {start}-{end} of {total}',
      }),
      'admin.emailLog': emailLogDict,
    };
    return (key: string, vars?: Record<string, string | number>) => {
      const v = dicts[ns]?.[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
  },
}));

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
}));

vi.mock('@/lib/email/log', () => ({
  listEmailLog: async () => ({
    rows: [
      {
        id: 1n,
        recipient: 'alice@example.com',
        subject: 'Invite',
        templateKey: 'invite',
        status: 'sent',
        errorMessage: null,
        relatedEntityType: 'invitation',
        relatedEntityId: 'abc',
        sentAt: new Date('2026-09-06T10:00:00Z'),
        createdAt: new Date('2026-09-06T10:00:00Z'),
      },
      {
        id: 2n,
        recipient: 'bob@example.com',
        subject: 'Reset',
        templateKey: 'password-reset',
        status: 'failed',
        errorMessage: 'smtp down',
        relatedEntityType: 'user',
        relatedEntityId: '42',
        sentAt: null,
        createdAt: new Date('2026-09-06T09:00:00Z'),
      },
    ],
    total: 2,
  }),
}));

vi.mock('@/app/admin/_components/admin-page-header', () => ({
  AdminPageHeader: ({ title, breadcrumb }: { title: string; breadcrumb?: Array<{ label: string }> }) =>
    createElement(
      'div',
      { 'data-testid': 'page-header' },
      createElement('h1', null, title),
      breadcrumb?.map((b, i) =>
        createElement('span', { key: i, 'data-testid': `crumb-${i}` }, b.label),
      ),
    ),
}));

vi.mock('@/app/admin/_components/admin-filter-bar', () => ({
  AdminFilterBar: ({
    filters,
    values,
  }: {
    filters: Array<{ name: string; label: string; options: Array<{ value: string; label: string }> }>;
    values?: Record<string, string>;
  }) =>
    createElement(
      'form',
      { 'data-testid': 'filter-bar' },
      filters.map((f) =>
        createElement(
          'label',
          { key: f.name, 'data-testid': `filter-${f.name}` },
          createElement('span', null, f.label),
          createElement(
            'select',
            { name: f.name, defaultValue: values?.[f.name] ?? '' },
            createElement('option', { value: '' }, 'All'),
            ...f.options.map((o) =>
              createElement('option', { key: o.value, value: o.value }, o.label),
            ),
          ),
        ),
      ),
    ),
}));

vi.mock('@/app/admin/_components/admin-table', () => ({
  AdminTable: ({ rows, columns, emptyTitle }: { rows: unknown[]; columns: Array<{ key: string; header: string }>; emptyTitle?: string }) =>
    createElement(
      'div',
      { 'data-testid': 'table' },
      rows.length === 0
        ? createElement('span', { 'data-testid': 'empty' }, emptyTitle)
        : createElement(
            'table',
            null,
            createElement(
              'thead',
              null,
              createElement(
                'tr',
                null,
                columns.map((c) => createElement('th', { key: c.key }, c.header)),
              ),
            ),
            createElement(
              'tbody',
              null,
              rows.map((_r, i) =>
                createElement('tr', { key: i, 'data-testid': `row-${i}` }),
              ),
            ),
          ),
    ),
}));

vi.mock('@/app/admin/_components/admin-pagination', () => ({
  AdminPagination: ({ label }: { total?: number; label: string }) =>
    createElement('nav', { 'data-testid': 'pagination' }, createElement('span', null, label)),
}));

vi.mock('@/app/admin/_components/admin-status-chip', () => ({
  AdminStatusChip: ({ children }: { children: React.ReactNode }) =>
    createElement('span', { 'data-testid': 'chip' }, children),
}));

import AdminEmailLogPage from '@/app/admin/email/log/page';

describe('AdminEmailLogPage', () => {
  it('renders title, breadcrumb chain, filters, table with rows + pagination', async () => {
    const html = renderToStaticMarkup(
      await AdminEmailLogPage({ searchParams: {} }),
    );

    // Title
    expect(html).toContain('Email log');
    // Breadcrumb chain
    expect(html).toContain('Admin');
    expect(html).toContain('Email');
    expect(html).toContain('Log');
    // Filter labels
    expect(html).toContain('>Status<');
    expect(html).toContain('>Template<');
    // Status filter options rendered
    expect(html).toContain('>sent<');
    expect(html).toContain('>failed<');
    // Template filter options rendered
    expect(html).toContain('>Invite<');
    expect(html).toContain('>Password reset<');
    // Rows rendered
    expect(html).toContain('data-testid="row-0"');
    expect(html).toContain('data-testid="row-1"');
    // Pagination present
    expect(html).toContain('data-testid="pagination"');
  });

  it('passes filter values through to AdminFilterBar', async () => {
    const html = renderToStaticMarkup(
      await AdminEmailLogPage({ searchParams: { status: 'failed', templateKey: 'invite' } }),
    );
    // The mocked AdminFilterBar renders a select with defaultValue
    expect(html).toContain('name="status"');
    expect(html).toContain('name="templateKey"');
  });
});
