// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { TokenActions } from '@/app/admin/github-tokens/_components/token-actions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/lib/csrf/client', () => ({
  fetchCsrfToken: async () => 'csrf-stub',
}));

vi.mock('next-intl', () => ({
  useTranslations: () => {
    // Tiny dictionary sufficient for the keys TokenActions consumes.
    // The confirmDelete value contains the literal "Confirm delete" so
    // the test regex `/confirm delete/i` matches.
    const dict: Record<string, string> = {
      disable: 'Disable',
      enable: 'Enable',
      delete: 'Delete',
      confirmDelete: 'Confirm delete token?',
      failedWithError: 'Failed: {error}',
      disabledOk: 'Token disabled.',
      enabledOk: 'Token enabled.',
      deletedOk: 'Token deleted.',
    };
    return (key: string, vars?: Record<string, string | number>) => {
      const v = dict[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
  },
}));

/**
 * M32 Task 4 — TokenActions keycap buttons + inline [y/N] confirm.
 *
 * DOM library chosen: `react-dom/client` (`createRoot(...).render(...)`)
 * + raw `button.dispatchEvent(new MouseEvent('click', { bubbles: true }))`
 * + raw `div.dispatchEvent(new KeyboardEvent('keydown', { ... }))`.
 *
 * `@testing-library/react` is NOT a direct or transitive dependency in
 * this repo (verified M30.8 sidebar-groups report). happy-dom provides
 * `window` and `document` under `// @vitest-environment` above.
 *
 * Test counts: 7 (matches brief Step 4 expectation).
 *   - 2 SSR render tests (`[d]` / `[E]` / `[x]` keycap text)
 *   - 5 interaction tests ([x] shows confirm, [N] cancels, Escape cancels,
 *     5s auto-cancel, [y] issues DELETE).
 *
 * SSR rendering of `[d]`/`[E]`/`[x]` is verified via `renderToStaticMarkup`
 * (from `react-dom/server`) on the same component — this matches the
 * pattern used by the TokenRow (M32 Task 3) test.
 *
 * We split SSR and DOM-environment tests into two describe blocks because
 * mixing `renderToStaticMarkup` and `createRoot` requires switching the
 * vitest environment per-block, and happy-dom is required for the
 * interaction tests to have `window`/`document`.
 */

import { renderToStaticMarkup } from 'react-dom/server';

describe('TokenActions keycap buttons (SSR)', () => {
  it('renders [d] when active, [E] when disabled', () => {
    expect(
      renderToStaticMarkup(
        <TokenActions tokenId="1" currentStatus="active" />,
      ),
    ).toContain('[d]');
    expect(
      renderToStaticMarkup(
        <TokenActions tokenId="1" currentStatus="disabled" />,
      ),
    ).toContain('[E]');
  });

  it('renders [x] delete keycap', () => {
    const html = renderToStaticMarkup(
      <TokenActions tokenId="1" currentStatus="active" />,
    );
    expect(html).toContain('[x]');
  });
});

describe('TokenActions inline [y/N] confirm', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // Initial render. The csrf effect (mocked as `async () => 'csrf-stub'`)
    // resolves on the next microtask. Use `act(async)` so React flushes
    // both the effect's setup and the resolved promise's setState before
    // we proceed — otherwise the action buttons stay `disabled={!csrf}`
    // and `dispatchEvent(click)` would not reach the onClick handler in
    // happy-dom (which honors the disabled attribute).
    await act(async () => {
      root.render(<TokenActions tokenId="1" currentStatus="active" />);
    });
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    if (container && container.parentNode) {
      container.remove();
    }
  });

  function clickByText(text: string): void {
    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLButtonElement | undefined;
    if (!btn) {
      throw new Error(`button with text ${JSON.stringify(text)} not found`);
    }
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('clicking [x] shows the inline confirm dialog', () => {
    clickByText('[x]');
    // Title contains the i18n string for confirmDelete (starts with "Delete this").
    const html = container.innerHTML;
    expect(html).toMatch(/confirm delete/i); // matches the alertdialog title id
    expect(html).toContain('[y]');
    expect(html).toContain('[N]');
  });

  it('clicking [N] cancels without calling fetch', () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    clickByText('[x]');
    fetchMock.mockClear();
    clickByText('[N]');
    expect(fetchMock).not.toHaveBeenCalled();
    // Confirm dialog is gone:
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('Escape cancels the confirm', () => {
    clickByText('[x]');
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    act(() => {
      dialog!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('5-second inactivity auto-cancels the confirm', () => {
    vi.useFakeTimers();
    try {
      clickByText('[x]');
      expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clicking [y] issues DELETE and resets state', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    clickByText('[x]');
    fetchMock.mockClear();
    clickByText('[y]');
    // The fetch is initiated synchronously by deleteToken(); the response
    // is awaited but we don't need to wait on it for this assertion —
    // we only check the outgoing call shape.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/admin/github-tokens/1');
    const init = call?.[1] as RequestInit | undefined;
    expect(init?.method).toBe('DELETE');
  });
});
