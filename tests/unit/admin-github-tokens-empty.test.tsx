import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TerminalEmptyState } from '@/app/admin/github-tokens/_components/terminal-empty-state';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/lib/csrf/client', () => ({
  fetchCsrfToken: async () => 'csrf-stub',
}));

vi.mock('@/lib/api/admin-fetch', () => ({
  adminFetch: vi.fn(async () => undefined),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => {
    // Minimal dictionary for the keys AddTokenForm consumes.
    const dict: Record<string, string> = {
      labelPlaceholder: 'Label',
      tokenPlaceholder: 'Token',
      tokenLabel: 'Paste token',
      submit: 'submit',
      success: 'added',
    };
    return (key: string) => dict[key] ?? key;
  },
}));

describe('TerminalEmptyState', () => {
  it('renders the empty-state copy and embeds AddTokenForm', () => {
    const html = renderToStaticMarkup(<TerminalEmptyState />);
    expect(html).toContain('ls tokens');
    expect(html).toMatch(/no tokens found|empty/);
    // The form input for label must be present.
    expect(html).toMatch(/<input[^>]*type="text"/);
    expect(html).toMatch(/<textarea/);
  });
});