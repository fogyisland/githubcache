import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminSidebar } from '@/app/admin/_components/admin-sidebar';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin'),
}));

vi.mock('next-intl', () => ({
  useTranslations: (_ns: string) => (key: string) => key,
}));

function findLink(html: string, href: string): { isCurrent: boolean; className: string } | null {
  // Match an <a ... href="/admin" ... class="..." ... aria-current="..." ...>...</a>
  // We use a simple regex; the test only cares about aria-current + className.
  const re = new RegExp(`<a[^>]*href="${href.replace(/[/]/g, '\\/')}"[^>]*>`, 'i');
  const match = html.match(re);
  if (!match) return null;
  const tag = match[0];
  const ariaMatch = tag.match(/aria-current="([^"]*)"/);
  const classMatch = tag.match(/class="([^"]*)"/);
  return {
    isCurrent: ariaMatch?.[1] === 'page',
    className: classMatch?.[1] ?? '',
  };
}

describe('AdminSidebar — client-side highlight', () => {
  beforeEach(async () => {
    const { usePathname } = await import('next/navigation');
    vi.mocked(usePathname).mockReturnValue('/admin');
  });

  it('highlights the dashboard slug when pathname is /admin', () => {
    const html = renderToStaticMarkup(<AdminSidebar userRole="admin" />);
    const link = findLink(html, '/admin');
    expect(link).not.toBeNull();
    expect(link!.isCurrent).toBe(true);
    expect(link!.className).toContain('ghc-admin-sidebar-current');
  });

  it('highlights users slug when pathname is /admin/users/3 (deep)', async () => {
    const { usePathname } = await import('next/navigation');
    vi.mocked(usePathname).mockReturnValue('/admin/users/3');
    const html = renderToStaticMarkup(<AdminSidebar userRole="admin" />);
    const link = findLink(html, '/admin/users');
    expect(link).not.toBeNull();
    expect(link!.isCurrent).toBe(true);
  });

  it('highlights email-log slug when pathname is /admin/email/log (exact match wins)', async () => {
    const { usePathname } = await import('next/navigation');
    vi.mocked(usePathname).mockReturnValue('/admin/email/log');
    const html = renderToStaticMarkup(<AdminSidebar userRole="admin" />);
    const link = findLink(html, '/admin/email/log');
    expect(link).not.toBeNull();
    expect(link!.isCurrent).toBe(true);
  });

  it('highlights email slug when pathname is /admin/email (parent page)', async () => {
    const { usePathname } = await import('next/navigation');
    vi.mocked(usePathname).mockReturnValue('/admin/email');
    const html = renderToStaticMarkup(<AdminSidebar userRole="admin" />);
    const link = findLink(html, '/admin/email');
    expect(link).not.toBeNull();
    expect(link!.isCurrent).toBe(true);
  });
});