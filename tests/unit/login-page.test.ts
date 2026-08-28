import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

// Stub the client form so the server component can render without
// pulling in the CSRF fetch path.
vi.mock('@/app/login/_login-form', () => ({
  LoginForm: () => createElement('form', { 'data-testid': 'login-form-stub' }),
}));

import LoginPage from '@/app/login/page';

describe('LoginPage (server shell)', () => {
  it('renders brand mark, headline, tagline, form card, and back-to-home link', () => {
    const html = renderToStaticMarkup(createElement(LoginPage));

    // Brand wordmark (lowercase eyebrow above headline)
    expect(html).toContain('github metadata cache');
    expect(html).toContain('Sign in to admin');
    expect(html).toContain('Manage tokens, schedule refreshes, audit requests.');

    // Form is rendered inside a ghc-card (themed via design system)
    expect(html).toContain('ghc-card');
    expect(html).toContain('login-form-stub');

    // Back link styled with ghc-link (themed accent color)
    expect(html).toContain('ghc-link');
    expect(html).toContain('Back to home');
    expect(html).toContain('href="/"');
  });

  it('uses theme tokens (no hardcoded colors)', () => {
    const html = renderToStaticMarkup(createElement(LoginPage));

    // Eyebrow + tagline should reference tokens, not hex
    expect(html).toContain('var(--color-accent)');
    expect(html).toContain('var(--color-ink-muted)');

    // No raw hex colors in the rendered markup
    expect(html).not.toMatch(/color:\s*#[0-9a-f]{3,6}/i);
  });

  it('has no inline layout styles — only design-system classes', () => {
    const html = renderToStaticMarkup(createElement(LoginPage));

    // Layout primitives from the framework + our class names. No
    // `style="max-width:..."` style attributes that the old placeholder used.
    expect(html).not.toMatch(/style="margin:\s*4rem auto/);
    expect(html).not.toMatch(/style="display:\s*block/);
    expect(html).toContain('max-w-[26rem]');
    expect(html).toContain('ghc-fade-up');
  });
});