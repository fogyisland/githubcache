import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Stub react-dom's useFormState hook — renderToStaticMarkup runs in
// Node without a form-state runtime, so the hook isn't defined here.
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    useFormState: (_action: unknown, initial: unknown) => [initial, () => undefined],
    useFormStatus: () => ({ pending: false }),
  };
});

// Stub next-intl/server — renderToStaticMarkup runs in Node without
// the RSC bundler context, so getTranslations falls through to the
// "not supported in Client Components" error. The site footer + nav
// only use translation keys, so identity passthrough is sufficient.
// getTranslations is async in production; mirror that signature.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

// Stub next/navigation so QuickTry's useRouter() can render server-side
// without needing an app-router runtime.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/',
}));

// Stub out the DB-backed recentLookups so we can import HomePage in isolation.
vi.mock('@/lib/db/repositories', () => ({
  recentLookups: async () => [],
}));

// Force the LookupForm's underlying action to be a no-op in render context.
vi.mock('@/app/_actions/lookup', () => ({
  lookupAction: async () => ({ status: 'idle' }),
}));

// Stub package.json import that SiteFooter depends on (Next would normally
// resolve this, but vitest needs a hint).
vi.mock('../../../package.json', () => ({
  default: { version: '0.0.0-test' },
}));

import HomePage from '@/app/page';

describe('public home page surface', () => {
  it('renders the api doc section with the curl example', async () => {
    const el = await HomePage();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('ghc-api-doc-section');
    expect(html).toContain('curl https://your-host/api/v1/repos/torvalds/linux');
    expect(html).toContain('torvalds/linux');
  });

  it('renders the quick try buttons for three well-known repos', async () => {
    const el = await HomePage();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('ghc-quick-try');
    // owner/name are rendered in separate spans, so check each.
    expect(html).toContain('torvalds');
    expect(html).toContain('microsoft');
    expect(html).toContain('vitejs');
    expect(html).toContain('linux');
    expect(html).toContain('vscode');
    expect(html).toContain('vite');
  });

  it('renders the new site footer with version + status link', async () => {
    const el = await HomePage();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('ghc-site-footer');
    // Mocked translator returns the key as-is, so we look for "version"
    // (the key name). In production with real translations this would
    // be "Version" (en) / "版本" (zh).
    expect(html).toMatch(/version<\/span>\s*<code>[^<]+<\/code>/i);
    expect(html).toContain('/api/v1/status');
    expect(html).toContain('/login');
  });
});

