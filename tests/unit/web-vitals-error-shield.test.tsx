// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { WebVitalsErrorShield } from '@/app/_components/web-vitals-error-shield';

/**
 * Regression: Next.js 14 → 15 upgrade (commit fa5ee47) deleted
 * `src/app/_components/web-vitals-error-shield.tsx` and removed its
 * mount from `src/app/layout.tsx`. The bundled
 * `node_modules/next/dist/compiled/web-vitals/web-vitals.js` still
 * reads `entries[entries.length-1].startTime` on an empty array
 * (the upstream getCLS bug), which throws on pages with heavy
 * `'use client'` tables like `/admin/refresh` and `/admin/queue`.
 *
 * The shield is a React component that:
 *   - returns `null` (renders nothing in the DOM)
 *   - in useEffect, registers capture-phase window listeners for
 *     'error' and 'unhandledrejection'
 *   - matches the known web-vitals startTime / reportAllChanges
 *     signature and calls preventDefault + stopImmediatePropagation
 *
 * Mounting the shield is the production fix; this test asserts
 * the listener installation is what we expect.
 */

describe('WebVitalsErrorShield', () => {
  let container: HTMLDivElement;
  let root: Root;
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    addSpy = vi.spyOn(window, 'addEventListener');
    removeSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('renders null (mount is invisible)', () => {
    root = createRoot(container);
    act(() => {
      root.render(<WebVitalsErrorShield />);
    });
    expect(container.innerHTML).toBe('');
  });

  it('installs capture-phase error and unhandledrejection listeners', () => {
    root = createRoot(container);
    act(() => {
      root.render(<WebVitalsErrorShield />);
    });

    const errorCalls = addSpy.mock.calls.filter(([type]: [string]) => type === 'error');
    const rejectionCalls = addSpy.mock.calls.filter(([type]: [string]) => type === 'unhandledrejection');

    expect(errorCalls.length).toBe(1);
    expect(rejectionCalls.length).toBe(1);

    // The capture-phase listener is the second arg of the second tuple
    // element: [handler, options]. capture must be true so the shield
    // fires BEFORE Next.js's own error reporter (which logs the
    // "Server Components render" diagnostic we're trying to silence).
    expect(errorCalls[0]?.[2]).toMatchObject({ capture: true });
    expect(rejectionCalls[0]?.[2]).toMatchObject({ capture: true });
  });

  it('removes its listeners on unmount (no leak across route navigations)', () => {
    root = createRoot(container);
    act(() => {
      root.render(<WebVitalsErrorShield />);
    });

    const errorAddCallsBefore = removeSpy.mock.calls
      .filter(([type]: [string]) => type === 'error')
      .length;

    act(() => {
      root.unmount();
    });

    const errorRemoveCalls = removeSpy.mock.calls.filter(([type]: [string]) => type === 'error');
    expect(errorRemoveCalls.length).toBe(errorAddCallsBefore + 1);
  });

  it('suppresses the upstream web-vitals startTime error', () => {
    root = createRoot(container);
    act(() => {
      root.render(<WebVitalsErrorShield />);
    });

    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();
    const error = new ErrorEvent('error', {
      message:
        "Cannot read properties of undefined (reading 'startTime')\n    at et.reportAllChanges (https://example/static/chunks/web-vitals.js:1:42)",
    });
    // Manually attach our spy handlers to the ErrorEvent prototype so the
    // addEventListener call from useEffect routes to them. happy-dom's
    // dispatchEvent doesn't run capture-phase listeners installed after
    // the event was constructed, so we simulate the upstream contract.
    Object.defineProperty(error, 'preventDefault', { value: preventDefault });
    Object.defineProperty(error, 'stopImmediatePropagation', { value: stopImmediatePropagation });

    window.dispatchEvent(error);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });
});