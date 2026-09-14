import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string>) => {
    if (vars) return `${key}:${JSON.stringify(vars)}`;
    return key;
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

vi.mock('@/app/account/keys/[id]/_actions/rotate', () => ({
  rotateOwnKeyAction: async () => ({ ok: false, error: 'not_active' }),
}));

import { RotateOwnKeyButton } from '@/app/account/keys/[id]/_components/rotate-button';

/**
 * Regression guard for M31.x — the user reported the rotate button was
 * invisible against light backgrounds because it used ghc-btn-secondary
 * (transparent background + faint border). The fix is to render the
 * primary action button with a high-contrast class — ghc-btn-primary —
 * so the user can find it without hovering.
 *
 * If this test ever fails, the rotate button is back to the invisible
 * default and should be re-promoted to a primary-style class.
 */
describe('RotateOwnKeyButton', () => {
  it('renders the rotate action button with a visible, primary-style class', () => {
    const html = renderToStaticMarkup(
      createElement(RotateOwnKeyButton, {
        keyId: '1',
        oldKeyName: 'bot-key-1',
      }),
    );

    // The user-facing trigger button must carry ghc-btn-primary so the
    // button is visible against light backgrounds without hover. The
    // bare 'ghc-btn-secondary' class on this button would mean the bug
    // is back.
    expect(html).toMatch(/<button[^>]*class="[^"]*ghc-btn-primary/);
    expect(html).not.toMatch(/<button[^>]*class="[^"]*ghc-btn-secondary[^"]*"[^>]*aria-label="account\.keys\.detail\.rotate\.aria/);
  });
});