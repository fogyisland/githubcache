import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';

describe('<AdminPagination />', () => {
  it('renders nothing when total is 0', () => {
    const html = renderToStaticMarkup(
      AdminPagination({
        basePath: '/admin/users',
        offset: 0,
        limit: 25,
        total: 0,
        rowsOnPage: 0,
        label: 'Showing 0–0 of 0',
      }),
    );
    expect(html).toBe('');
  });

  it('renders the showing range label with start/end/total substituted', () => {
    const html = renderToStaticMarkup(
      AdminPagination({
        basePath: '/admin/users',
        offset: 0,
        limit: 25,
        total: 100,
        rowsOnPage: 25,
        label: 'Showing 1–25 of 100',
      }),
    );
    expect(html).toContain('Showing 1–25 of 100');
  });

  it('disables prev on the first page', () => {
    const html = renderToStaticMarkup(
      AdminPagination({
        basePath: '/admin/users',
        offset: 0,
        limit: 25,
        total: 100,
        rowsOnPage: 25,
        label: 'x',
      }),
    );
    expect(html).toContain('aria-disabled="true"');
    // Next page link must still be present.
    expect(html).toContain('href="/admin/users?');
    expect(html).toContain('offset=25');
  });

  it('disables next on the last page when rowsOnPage exactly fills the remaining rows', () => {
    const html = renderToStaticMarkup(
      AdminPagination({
        basePath: '/admin/users',
        offset: 75,
        limit: 25,
        total: 100,
        rowsOnPage: 25,
        label: 'x',
      }),
    );
    // Two disabled markers: prev (already disabled because offset > 0
    // would still be active — wait, offset=75 > 0 so prev is enabled).
    // We expect only ONE disabled (the next link, since end=100=total).
    const disabledCount = (html.match(/aria-disabled="true"/g) ?? []).length;
    expect(disabledCount).toBe(1);
    expect(html).toContain('offset=50'); // prev href
  });

  it('disables both prev and next when there is exactly one page', () => {
    const html = renderToStaticMarkup(
      AdminPagination({
        basePath: '/admin/users',
        offset: 0,
        limit: 25,
        total: 10,
        rowsOnPage: 10,
        label: 'x',
      }),
    );
    const disabledCount = (html.match(/aria-disabled="true"/g) ?? []).length;
    expect(disabledCount).toBe(2);
  });

  it('preserves extraSearch params (filters) across pagination', () => {
    const html = renderToStaticMarkup(
      AdminPagination({
        basePath: '/admin/users',
        offset: 0,
        limit: 25,
        total: 100,
        rowsOnPage: 25,
        label: 'x',
        extraSearch: { role: 'admin', status: 'active' },
      }),
    );
    expect(html).toMatch(/role=admin/);
    expect(html).toMatch(/status=active/);
    expect(html).toContain('offset=25');
  });

  it('clamps prev offset to 0 (no negative offsets)', () => {
    const html = renderToStaticMarkup(
      AdminPagination({
        basePath: '/admin/users',
        offset: 5, // offset 5 with limit 25
        limit: 25,
        total: 100,
        rowsOnPage: 25,
        label: 'x',
      }),
    );
    // Prev goes to offset - 25 = -20, must clamp to 0
    expect(html).not.toMatch(/offset=-/);
    expect(html).toContain('offset=0');
  });

  it('handles rowsOnPage=0 (offset past end but not total-clamped) by hiding next', () => {
    const html = renderToStaticMarkup(
      AdminPagination({
        basePath: '/admin/users',
        offset: 1000,
        limit: 25,
        total: 100,
        rowsOnPage: 0,
        label: 'x',
      }),
    );
    // Both disabled: offset > 0 → prev enabled actually
    // offset=1000, total=100, rowsOnPage=0 → end=1000 ≥ total → next disabled
    expect(html).toContain('offset=975'); // prev enabled
    const disabledCount = (html.match(/aria-disabled="true"/g) ?? []).length;
    expect(disabledCount).toBe(1);
  });
});