// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TokenActions } from '@/app/admin/github-tokens/_components/token-actions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/lib/csrf/client', () => ({
  fetchCsrfToken: async () => 'csrf-stub',
}));

vi.mock('next-intl', () => ({
  useTranslations: () => {
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
 * M32.5 — TokenActions now renders as a ghc-btn-* cluster (status
 * toggle) + AdminConfirmDialog (delete). The dialog's showModal()
 * behavior is covered by the shared AdminConfirmDialog component; here
 * we verify the wiring: button labels flip by status, and the Disable
 * button issues the right PATCH. Delete is end-to-end covered via
 * Playwright on /admin/github-tokens.
 */
describe('TokenActions ghc-btn cluster (SSR)', () => {
  it('renders Disable when status is active', () => {
    const html = renderToStaticMarkup(<TokenActions tokenId="1" currentStatus="active" />);
    expect(html).toContain('Disable');
  });

  it('renders Enable when status is disabled', () => {
    const html = renderToStaticMarkup(<TokenActions tokenId="1" currentStatus="disabled" />);
    expect(html).toContain('Enable');
  });

  it('always renders Delete trigger', () => {
    const active = renderToStaticMarkup(<TokenActions tokenId="1" currentStatus="active" />);
    const disabled = renderToStaticMarkup(<TokenActions tokenId="1" currentStatus="disabled" />);
    expect(active).toContain('Delete');
    expect(disabled).toContain('Delete');
  });
});

describe('TokenActions status toggle (interaction)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
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

  it('Disable button issues PATCH /api/admin/github-tokens/1 with status=disabled', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Disable',
    ) as HTMLButtonElement | undefined;
    expect(btn).toBeDefined();
    await act(async () => {
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/admin/github-tokens/1');
    const init = call?.[1] as RequestInit | undefined;
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({
      status: 'disabled',
      csrf: 'csrf-stub',
    });
  });
});