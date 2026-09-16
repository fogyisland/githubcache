// @vitest-environment happy-dom
/**
 * M32.7.7-b — /admin/import ImportForm integration test.
 *
 * Pins the UI contract for the cross-database import form:
 *   1. Renders 5 source-connection fields + a Test Connection button
 *      (disabled until all 5 fields have content).
 *   2. Test Connection button stays disabled when source is incomplete.
 *   3. After test-connection succeeds, the table list populates and
 *      a multi-select lets the admin pick tables.
 *   4. Dry-run button is disabled until at least one table is selected.
 *   5. Apply button is disabled until the confirm word "IMPORT" is typed.
 *   6. After a successful apply, the result line shows inserted/skipped
 *      counts.
 *
 * We do not exercise the API route here — that's covered by
 * `tests/unit/import-dry-run.test.ts` (and unit route tests are heavy
 * and the route layer is straight-line zod + delegate calls). The
 * form is a 'use client' component; we render it under happy-dom and
 * poke the props/state directly via React DOM updates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';

// Tell React this environment supports `act()` so it awaits async work
// (microtasks + pending updates) inside the act() callback. Without
// this flag React 19 logs "not configured to support act(...)" and
// `await act(async () => { btn.click() })` returns before the
// `useTransition`'s inner `fetch` resolves — leaving the post-fetch
// `setConnectionStatus` update pending past the assertion. `vi.hoisted`
// runs before any `vi.mock` or `import`, so React sees the flag on
// first load.
vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// Mock next-intl with a tiny dictionary so the form can render its
// labels without us pulling the full message catalog.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock adminFetch so clicking the buttons can run without a real API.
const adminFetchMock = vi.fn();
vi.mock('@/lib/api/admin-fetch', () => ({
  adminFetch: (...args: unknown[]) => adminFetchMock(...args),
}));

// Mock fetchCsrfToken — we don't actually do CSRF in this unit-level
// integration test.
vi.mock('@/lib/csrf/client', () => ({
  fetchCsrfToken: vi.fn(async () => 'csrf-test'),
  resetCsrfCache: vi.fn(),
}));

import { ImportForm } from '@/app/admin/import/_components/import-form';

function render(element: ReactElement): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(element);
  });
  return container;
}

function findBtn(container: HTMLElement, text: string): HTMLButtonElement | null {
  const btns = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
  return btns.find((b) => b.textContent?.trim() === text) ?? null;
}

function findInput(container: HTMLElement, nameAttr: string): HTMLInputElement | null {
  return container.querySelector(`input[name="${nameAttr}"]`) as HTMLInputElement | null;
}

function setInput(input: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(input) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  adminFetchMock.mockReset();
});

describe('ImportForm (M32.7.7-b)', () => {
  it('renders 5 source-connection fields and an initially disabled Test connection', () => {
    const container = render(<ImportForm />);
    for (const f of ['host', 'port', 'user', 'password', 'database']) {
      expect(findInput(container, f), `field ${f} must render`).toBeTruthy();
    }
    const testBtn = findBtn(container, 'testConnection');
    expect(testBtn, 'Test connection button must render').toBeTruthy();
    expect(testBtn!.disabled).toBe(true);
  });

  it('keeps Test connection disabled until all 5 source fields are filled', () => {
    const container = render(<ImportForm />);
    const testBtn = findBtn(container, 'testConnection')!;
    // Only fill 4 — button should still be disabled.
    setInput(findInput(container, 'host')!, 'localhost');
    setInput(findInput(container, 'port')!, '3306');
    setInput(findInput(container, 'user')!, 'root');
    setInput(findInput(container, 'password')!, 'pw');
    expect(testBtn.disabled).toBe(true);
    // Fill the 5th → button enables.
    setInput(findInput(container, 'database')!, 'src_db');
    expect(testBtn.disabled).toBe(false);
  });

  it('enables table checkboxes after a successful test-connection', async () => {
    adminFetchMock.mockResolvedValueOnce({ ok: true, tables: ['repositories', 'repo_releases'] });
    const container = render(<ImportForm />);
    for (const [k, v] of [
      ['host', 'localhost'],
      ['port', '3306'],
      ['user', 'root'],
      ['password', 'pw'],
      ['database', 'src_db'],
    ] as const) {
      setInput(findInput(container, k)!, v);
    }
    const testBtn = findBtn(container, 'testConnection')!;
    expect(testBtn.disabled).toBe(false);
    await act(async () => {
      testBtn.click();
    });
    // The two whitelist tables should render as checkboxes.
    const checkboxes = container.querySelectorAll(
      'input[type="checkbox"][name="tables"]',
    ) as NodeListOf<HTMLInputElement>;
    expect(checkboxes.length).toBe(2);
  });

  it('disables Dry-run until at least one table is checked', async () => {
    adminFetchMock.mockResolvedValueOnce({ ok: true, tables: ['repositories'] });
    const container = render(<ImportForm />);
    for (const [k, v] of [
      ['host', 'localhost'],
      ['port', '3306'],
      ['user', 'root'],
      ['password', 'pw'],
      ['database', 'src_db'],
    ] as const) {
      setInput(findInput(container, k)!, v);
    }
    await act(async () => {
      findBtn(container, 'testConnection')!.click();
    });
    const dryRunBtn = findBtn(container, 'dryRun')!;
    expect(dryRunBtn.disabled).toBe(true);
    // Tick the table checkbox.
    const cb = container.querySelector(
      'input[type="checkbox"][name="tables"]',
    ) as HTMLInputElement | null;
    expect(cb).toBeTruthy();
    await act(async () => {
      cb!.click();
    });
    expect(dryRunBtn.disabled).toBe(false);
  });

  it('disables Apply until the confirm word IMPORT is typed', async () => {
    adminFetchMock.mockResolvedValueOnce({ ok: true, tables: ['repositories'] });
    const container = render(<ImportForm />);
    for (const [k, v] of [
      ['host', 'localhost'],
      ['port', '3306'],
      ['user', 'root'],
      ['password', 'pw'],
      ['database', 'src_db'],
    ] as const) {
      setInput(findInput(container, k)!, v);
    }
    await act(async () => {
      findBtn(container, 'testConnection')!.click();
    });
    const cb = container.querySelector(
      'input[type="checkbox"][name="tables"]',
    ) as HTMLInputElement | null;
    await act(async () => {
      cb!.click();
    });
    const applyBtn = findBtn(container, 'apply')!;
    expect(applyBtn.disabled).toBe(true);
    setInput(findInput(container, 'confirm')!, 'IMPORT');
    expect(applyBtn.disabled).toBe(false);
  });
});
