import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string>) => {
    if (vars) return `${key}:${JSON.stringify(vars)}`;
    return key;
  },
}));

// Mock react-dom hooks (useFormState, useFormStatus) — these are client-side
// hooks and not available in the node SSR environment that renderToStaticMarkup
// uses. The LangSwitcher is a client component but we render it to static
// markup for shape-only assertions, so the action + form state can be stubs.
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    useFormState: (_action: unknown, _initial: unknown) => [_initial, () => undefined],
    useFormStatus: () => ({ pending: false }),
  };
});

// Mock the action to avoid pulling in the server action runtime
vi.mock('@/app/_actions/set-lang', () => ({
  setLangAction: () => undefined,
}));

import { LangSwitcher } from '@/app/_components/lang-switcher';

describe('LangSwitcher', () => {
  it('renders one button per locale in LOCALES', () => {
    const html = renderToStaticMarkup(createElement(LangSwitcher, { current: 'zh', locales: ['zh', 'en'] }));
    const buttonCount = (html.match(/<button/g) ?? []).length;
    expect(buttonCount).toBe(2);
  });

  it('marks the active locale with aria-pressed=true', () => {
    const html = renderToStaticMarkup(createElement(LangSwitcher, { current: 'en', locales: ['zh', 'en'] }));
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-active="true"');
    // Only one button is active
    expect((html.match(/data-active="true"/g) ?? []).length).toBe(1);
  });

  it('emits a form with role=radiogroup and an aria-label', () => {
    const html = renderToStaticMarkup(createElement(LangSwitcher, { current: 'zh', locales: ['zh', 'en'] }));
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label=');
  });
});
