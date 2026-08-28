import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/docs/api/v1-repos',
}));

import { DocsSidebar } from '@/app/docs/_components/docs-sidebar';

describe('DocsSidebar', () => {
  it('renders all endpoint slugs as nav links', () => {
    const html = renderToStaticMarkup(createElement(DocsSidebar));
    expect(html).toContain('/docs/api/v1-status');
    expect(html).toContain('/docs/api/v1-repos');
    expect(html).toContain('/docs/api/query');
  });
  it('marks the active slug with ghc-doc-sidebar-current', () => {
    const html = renderToStaticMarkup(createElement(DocsSidebar));
    expect(html).toContain('ghc-doc-sidebar-current');
    expect(html).toContain('/docs/api/v1-repos');
  });
});
