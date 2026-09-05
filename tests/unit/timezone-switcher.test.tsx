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

// Mock react-dom hooks — see lang-switcher.test.tsx for the same rationale.
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    useFormState: (_action: unknown, _initial: unknown) => [_initial, () => undefined],
    useFormStatus: () => ({ pending: false }),
  };
});

// Mock the action to avoid pulling in the server action runtime
vi.mock('@/app/_actions/set-timezone', () => ({
  setTimezoneAction: () => undefined,
}));

import { TimezoneSwitcher } from '@/app/_components/timezone-switcher';
import { TIMEZONE_IDS } from '@/lib/timezone/registry';

describe('TimezoneSwitcher', () => {
  it('renders one <option> per TIMEZONE_IDS', () => {
    const html = renderToStaticMarkup(createElement(TimezoneSwitcher, { current: 'UTC' }));
    const optionCount = (html.match(/<option/g) ?? []).length;
    expect(optionCount).toBe(TIMEZONE_IDS.length);
  });

  it('marks the current timezone as the <select> default', () => {
    const html = renderToStaticMarkup(
      createElement(TimezoneSwitcher, { current: 'America/Los_Angeles' }),
    );
    // The <option> for the current tz should be selected
    expect(html).toContain('value="America/Los_Angeles" selected');
  });

  it('emits a form with an aria-label and a sr-only <label>', () => {
    const html = renderToStaticMarkup(createElement(TimezoneSwitcher, { current: 'UTC' }));
    expect(html).toContain('aria-label=');
    expect(html).toContain('class="sr-only"');
    // React's htmlFor attribute renders as `for` in HTML output
    expect(html).toContain('for="ghc-tz-select"');
  });

  it('includes the sr-only state mirror with the current tz', () => {
    const html = renderToStaticMarkup(
      createElement(TimezoneSwitcher, { current: 'Asia/Tokyo' }),
    );
    expect(html).toContain('data-current-tz="Asia/Tokyo"');
    expect(html).toContain('data-tz-state="idle"');
  });
});
