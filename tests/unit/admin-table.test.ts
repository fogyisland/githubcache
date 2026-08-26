import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminFilterBar, type AdminFilter } from '@/app/admin/_components/admin-filter-bar';

interface Row {
  id: string;
  name: string;
  status: string;
}

const columns: AdminColumn<Row>[] = [
  { key: 'name', header: 'Name', render: (r) => r.name },
  {
    key: 'status',
    header: 'Status',
    render: (r) => r.status,
    align: 'right',
  },
];

describe('AdminTable', () => {
  it('renders headers and rows', () => {
    const rows: Row[] = [
      { id: '1', name: 'alice', status: 'active' },
      { id: '2', name: 'bob', status: 'revoked' },
    ];
    const html = renderToStaticMarkup(
      createElement(AdminTable as React.ComponentType<{
        columns: AdminColumn<Row>[];
        rows: Row[];
      }>, { columns, rows }),
    );
    expect(html).toContain('Name</th>');
    expect(html).toContain('alice');
    expect(html).toContain('bob');
    expect(html).toContain('active');
    expect(html).toContain('revoked');
  });

  it('renders empty state when no rows', () => {
    const html = renderToStaticMarkup(
      createElement(AdminTable as React.ComponentType<{
        columns: AdminColumn<Row>[];
        rows: Row[];
        emptyTitle?: string;
        emptyDescription?: string;
      }>, {
        columns,
        rows: [],
        emptyTitle: 'No users yet',
        emptyDescription: 'Invite your first operator',
      }),
    );
    expect(html).toContain('No users yet');
    expect(html).toContain('ghc-admin-empty');
    expect(html).not.toContain('<th');
  });

  it('renders loading skeleton when isLoading', () => {
    const html = renderToStaticMarkup(
      createElement(AdminTable as React.ComponentType<{
        columns: AdminColumn<Row>[];
        rows: Row[];
        isLoading?: boolean;
      }>, { columns, rows: [], isLoading: true }),
    );
    expect(html).toContain('ghc-admin-skeleton');
  });

  it('renders pagination links preserving basePath', () => {
    const html = renderToStaticMarkup(
      createElement(AdminTable as React.ComponentType<{
        columns: AdminColumn<Row>[];
        rows: Row[];
        pagination?: { total: number; limit: number; offset: number; basePath: string };
      }>, {
        columns,
        rows: [{ id: '1', name: 'alice', status: 'active' }],
        pagination: { total: 50, limit: 10, offset: 0, basePath: '/admin/users' },
      }),
    );
    expect(html).toContain('Next');
    expect(html).toContain('/admin/users?offset=10');
    expect(html).toContain('1–10');
    expect(html).toContain('50');
  });

  it('renders Prev link when offset > 0', () => {
    const html = renderToStaticMarkup(
      createElement(AdminTable as React.ComponentType<{
        columns: AdminColumn<Row>[];
        rows: Row[];
        pagination?: { total: number; limit: number; offset: number; basePath: string };
      }>, {
        columns,
        rows: [{ id: '1', name: 'alice', status: 'active' }],
        pagination: { total: 50, limit: 10, offset: 20, basePath: '/admin/users' },
      }),
    );
    expect(html).toContain('Prev');
    expect(html).toContain('/admin/users?offset=10');
  });

  it('wraps each row in a link when rowHref is provided', () => {
    const html = renderToStaticMarkup(
      createElement(AdminTable as React.ComponentType<{
        columns: AdminColumn<Row>[];
        rows: Row[];
        rowHref?: (row: Row) => string;
      }>, {
        columns,
        rows: [{ id: '1', name: 'alice', status: 'active' }],
        rowHref: (r: Row) => `/admin/users/${r.id}`,
      }),
    );
    expect(html).toContain('href="/admin/users/1"');
  });
});

describe('AdminFilterBar', () => {
  it('renders one select per filter with current value selected', () => {
    const filters: AdminFilter[] = [
      {
        name: 'role',
        label: 'Role',
        options: [
          { value: 'admin', label: 'Admin' },
          { value: 'operator', label: 'Operator' },
        ],
      },
      {
        name: 'status',
        label: 'Status',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'disabled', label: 'Disabled' },
        ],
      },
    ];
    const html = renderToStaticMarkup(
      createElement(AdminFilterBar as React.ComponentType<{
        filters: AdminFilter[];
        basePath: string;
        values?: Record<string, string>;
      }>, {
        filters,
        basePath: '/admin/users',
        values: { role: 'operator' },
      }),
    );
    expect(html).toContain('action="/admin/users"');
    expect(html).toContain('method="get"');
    expect(html).toContain('name="role"');
    expect(html).toContain('name="status"');
    // selected option
    expect(html).toContain('value="operator"');
    expect(html).toContain('value="active"');
  });

  it('renders All option when value not in values', () => {
    const filters: AdminFilter[] = [
      {
        name: 'role',
        label: 'Role',
        options: [
          { value: 'admin', label: 'Admin' },
          { value: 'operator', label: 'Operator' },
        ],
      },
    ];
    const html = renderToStaticMarkup(
      createElement(AdminFilterBar as React.ComponentType<{
        filters: AdminFilter[];
        basePath: string;
      }>, { filters, basePath: '/admin/users' }),
    );
    // When no value provided, "All" should be selected by default
    expect(html).toContain('value=""');
    expect(html).toMatch(/<option[^>]*selected[^>]*>All<\/option>/);
  });
});