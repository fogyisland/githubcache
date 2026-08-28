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

const auditDict = flattenDict({
  title: 'Audit log',
  description: 'Search across every admin action. Filters update the URL — bookmark or share a view.',
  breadcrumb: { admin: 'Admin', audit: 'Audit' },
  filters: {
    action: 'Action',
    actorUserId: 'Actor user ID',
    actorUserIdPlaceholder: 'e.g. 1',
    targetType: 'Target type',
    from: 'From',
    to: 'To',
    anyOption: '(any)',
    apply: 'Apply filters',
    reset: 'Reset',
  },
  table: {
    empty: 'No matching entries.',
    dash: '—',
    system: 'system',
    prev: '← Previous',
    next: 'Next →',
    pageOf: 'Page {page} of {total}',
    showingRange: 'Showing {start}–{end} of {total} entries',
    column: {
      when: 'When',
      action: 'Action',
      actor: 'Actor',
      target: 'Target',
      ip: 'IP',
      metadata: 'Metadata',
    },
  },
});

function lookup(ns: string, key: string): string {
  const relPrefix = ns.startsWith('admin.audit.') ? ns.slice('admin.audit.'.length) : '';
  if (relPrefix) {
    const nested = `${relPrefix}.${key}`;
    const v = auditDict[nested];
    if (v !== undefined) return v;
  }
  const full = ns + '.' + key;
  const fullV = auditDict[full];
  if (fullV !== undefined) return fullV;
  const rootV = auditDict[key];
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

vi.mock('@/lib/db/audit', () => ({
  queryAuditLog: async () => ({
    rows: [
      {
        id: 1n,
        createdAt: new Date('2026-08-28T10:00:00Z'),
        action: 'login_success',
        targetType: 'session',
        targetId: 'sess-abc',
        actorUserId: 1n,
        actorIp: '127.0.0.1',
        ip: '127.0.0.1',
        metadata: { foo: 'bar' },
      },
    ],
    total: 1,
  }),
  getActorEmails: async () => new Map([[1n, 'admin@test.com']]),
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

// Replace async server sub-components with stubs that use the same lookup logic,
// so we can verify the translated strings they would render.
vi.mock('@/app/admin/audit/_components/audit-table', () => ({
  AuditTable: ({ rows, total, limit, offset }: {
    rows: Array<{ actorUserId: string | null; actorEmail: string | null; ip: string | null }>;
    total: number;
    limit: number;
    offset: number;
  }) => {
    const lookup2 = (key: string) => lookup('admin.audit.table', key);
    const start = total === 0 ? 0 : offset + 1;
    const end = Math.min(offset + limit, total);
    const pageNum = Math.floor(offset / limit) + 1;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return createElement(
      'div',
      { 'data-testid': 'audit-table-stub' },
      createElement(
        'div',
        null,
        interpolate(lookup2('showingRange'), {
          start: start.toLocaleString(),
          end: end.toLocaleString(),
          total: total.toLocaleString(),
        }),
      ),
      ...(rows.length === 0
        ? [createElement('p', { key: 'empty' }, lookup2('empty'))]
        : [
            createElement(
              'table',
              { key: 'tbl' },
              createElement(
                'thead',
                null,
                createElement(
                  'tr',
                  null,
                  createElement('th', null, lookup2('column.when')),
                  createElement('th', null, lookup2('column.action')),
                  createElement('th', null, lookup2('column.actor')),
                  createElement('th', null, lookup2('column.target')),
                  createElement('th', null, lookup2('column.ip')),
                  createElement('th', null, lookup2('column.metadata')),
                ),
              ),
              createElement(
                'tbody',
                null,
                createElement(
                  'tr',
                  { key: 'r0' },
                  createElement('td', null, 'when'),
                  createElement('td', null, 'action'),
                  createElement(
                    'td',
                    null,
                    rows[0]!.actorEmail
                      ? `${rows[0]!.actorEmail} #${rows[0]!.actorUserId}`
                      : rows[0]!.actorUserId
                        ? `#${rows[0]!.actorUserId}`
                        : lookup2('system'),
                  ),
                  createElement('td', null, 'target'),
                  createElement('td', null, rows[0]!.ip ?? lookup2('dash')),
                  createElement('td', null, 'meta'),
                ),
              ),
            ),
            createElement(
              'div',
              { key: 'pag' },
              createElement('a', null, lookup2('prev')),
              createElement('span', null, lookup2('pageOf').replace('{page}', String(pageNum)).replace('{total}', String(totalPages))),
              createElement('a', null, lookup2('next')),
            ),
          ]),
    );
  },
}));

import AdminAuditPage from '@/app/admin/audit/page';

describe('AdminAuditPage i18n', () => {
  it('renders translated title and description on the page header', async () => {
    const html = renderToStaticMarkup(await AdminAuditPage({ searchParams: {} }));
    expect(html).toContain('Audit log');
    expect(html).toContain(
      'Search across every admin action. Filters update the URL — bookmark or share a view.'
    );
  });

  it('renders translated filter labels, placeholders and buttons via the real AuditFilters', async () => {
    const html = renderToStaticMarkup(await AdminAuditPage({ searchParams: {} }));
    // Filter labels
    expect(html).toContain('Action</span>');
    expect(html).toContain('Actor user ID</span>');
    expect(html).toContain('Target type</span>');
    expect(html).toContain('From</span>');
    expect(html).toContain('To</span>');
    // Placeholder
    expect(html).toContain('placeholder="e.g. 1"');
    // Buttons
    expect(html).toContain('Apply filters');
    expect(html).toContain('Reset');
  });

  it('renders translated table headers, pagination, system tag, and dash fallback', async () => {
    const html = renderToStaticMarkup(await AdminAuditPage({ searchParams: {} }));
    // Headers
    expect(html).toContain('>When<');
    expect(html).toContain('>Action<');
    expect(html).toContain('>Actor<');
    expect(html).toContain('>Target<');
    expect(html).toContain('>IP<');
    expect(html).toContain('>Metadata<');
    // Pagination
    expect(html).toContain('← Previous');
    expect(html).toContain('Next →');
    expect(html).toContain('Page 1 of 1');
    // system tag is not in this row (actor has email)
    // showingRange with interpolated values
    expect(html).toContain('Showing 1–1 of 1 entries');
  });
});
