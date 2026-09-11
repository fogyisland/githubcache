import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const labels: Record<string, Record<string, string>> = {
      'admin.shell.palette': {
        placeholder: 'Search admin — sections, recent actions…',
        noMatches: 'No matches for "{query}"',
        sections: 'Sections',
        recentAudit: 'Recent audit',
        detailsHeading: 'Quick links',
        recentAuditEmpty: 'No recent activity yet',
        goToDetail: 'Go to {label}',
        tryExamples: 'Try: refresh, audit, users',
        hintNav: 'navigate',
        hintOpen: 'open',
        hintClose: 'close',
        loading: 'Loading…',
      },
    };
    return (key: string, vars?: Record<string, string | number>) => {
      const v = labels[ns]?.[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
  },
}));

import { CommandPalette } from '@/app/admin/_components/command-palette';

describe('CommandPalette (SSR initial render)', () => {
  beforeEach(() => {
    // SSR renders the loading state — fetch hasn't fired yet.
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a dialog + input', () => {
    const html = renderToStaticMarkup(createElement(CommandPalette));
    expect(html).toContain('ghc-admin-palette-dialog');
    expect(html).toMatch(/<input[^>]*placeholder="[^"]*[Ss]earch[^"]*"/);
  });

  it('renders the loading placeholder before fetch resolves', () => {
    const html = renderToStaticMarkup(createElement(CommandPalette));
    expect(html).toContain('Loading');
  });

  it('accepts no props', () => {
    // The component dropped its `data` prop in Task 2 (M30) — the
    // palette lazy-fetches its own data. Confirm the no-arg render
    // path works and the dialog still mounts.
    const html = renderToStaticMarkup(createElement(CommandPalette));
    expect(html).toContain('ghc-admin-palette-dialog');
  });
});

// Recursion regression is verified at the source level — see the
// review round 1 fix notes. The keyboard handler in the live
// component (lines 178-196 in command-palette.tsx) registers ONLY
// a `keydown` listener, never a `ghc:open-palette` listener. The
// fetch effect (lines 159-167) is the sole listener for that
// event, and it uses `{ once: true }`. End-to-end browser smoke
// test is queued for the M30-final Playwright run; until then, the
// SSR shell tests above + this comment are the safety nets.
