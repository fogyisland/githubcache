import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CommandPalette } from '@/app/admin/_components/command-palette';

const paletteData = {
  sections: [
    { slug: 'dashboard', title: 'Dashboard', icon: '◉', href: '/admin' },
    { slug: 'users', title: 'Users', icon: '◐', href: '/admin/users' },
    { slug: 'api-keys', title: 'API Keys', icon: '⌬', href: '/admin/api-keys' },
  ],
  recentAudit: [
    { id: '1', action: 'user.invited', actor: 'admin@example.com', createdAt: '2026-08-27T12:00:00.000Z' },
    { id: '2', action: 'apikey.revoked', actor: 'admin@example.com', createdAt: '2026-08-27T11:00:00.000Z' },
  ],
};

describe('CommandPalette', () => {
  it('renders a dialog + input', () => {
    const html = renderToStaticMarkup(createElement(CommandPalette, { data: paletteData }));
    expect(html).toContain('ghc-admin-palette-dialog');
    expect(html).toMatch(/<input[^>]*placeholder="[^"]*[Ss]earch[^"]*"/);
  });

  it('pre-filters sections by query (case-insensitive substring)', () => {
    const html = renderToStaticMarkup(
      createElement(CommandPalette, { data: paletteData, query: 'user' }),
    );
    expect(html).toContain('Users');
    expect(html).toContain('href="/admin/users"');
    expect(html).not.toContain('href="/admin"');
    expect(html).not.toContain('href="/admin/api-keys"');
  });

  it('shows recent audit entries when query matches', () => {
    const html = renderToStaticMarkup(
      createElement(CommandPalette, { data: paletteData, query: 'apikey' }),
    );
    expect(html).toContain('apikey.revoked');
    expect(html).toContain('Recent audit');
    // The other entry should be filtered out by the 'apikey' query.
    expect(html).not.toContain('user.invited');
  });

  it('renders an empty-results state when nothing matches', () => {
    const html = renderToStaticMarkup(
      createElement(CommandPalette, { data: paletteData, query: 'zzzzzzz' }),
    );
    expect(html).toMatch(/No matches for/);
  });
});