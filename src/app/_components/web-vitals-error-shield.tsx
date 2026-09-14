'use client';

import { useEffect } from 'react';

/**
 * M28 — swallow the known web-vitals 3.0.0 TypeError that Next.js 14.2.x
 * triggers from its bundled dev/runtime perf panel:
 *
 *   "Cannot read properties of undefined (reading 'startTime')"
 *   at onCLS / reportAllChanges
 *
 * Source: web-vitals 3.0's getCLS reads `I[I.length-1].startTime` from
 * an empty sessions array. In modern Chromium `layout-shift` entries
 * can be empty for paint-only frames, so the very first CLS callback
 * crashes. The error fires from a `requestIdleCallback` chain and
 * doesn't affect the React tree, BUT some browsers treat the
 * unhandled exception as a fatal hot-path failure that aborts the
 * pending layout work for that micro-task — which on Next.js App
 * Router manifests as: click a sidebar link, the right pane updates,
 * the sidebar highlight stays on the previous page.
 *
 * Mounting a global error handler that matches the signature and
 * calling `event.preventDefault()` returns a clean idle frame and
 * keeps the sidebar in sync with navigation.
 *
 * Production builds DO include the bundled web-vitals (Next.js
 * re-exports `useReportWebVitals` even in prod) but the bug only
 * fires when the CLS observer actually delivers an entry — which
 * happens whenever a user-respecting layout shift occurs. So we
 * also keep the shield in prod (the only cost is one extra
 * error listener at module init).
 */
export function WebVitalsErrorShield(): null {
  useEffect(() => {
    function isWebVitalsStartTimeError(msg: string | undefined): boolean {
      if (!msg) return false;
      return (
        msg.includes("Cannot read properties of undefined (reading 'startTime')") &&
        (msg.includes('reportAllChanges') || msg.includes('onCLS') || msg.includes('getCLS'))
      );
    }
    function onError(event: ErrorEvent): void {
      const msg = event.message ?? event.error?.message;
      if (isWebVitalsStartTimeError(msg)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        // eslint-disable-next-line no-console
        console.warn('[web-vitals-shield] suppressed known upstream bug:', msg);
      }
    }
    function onUnhandledRejection(event: PromiseRejectionEvent): void {
      const reason = event.reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      if (isWebVitalsStartTimeError(msg)) {
        event.preventDefault();
      }
    }
    window.addEventListener('error', onError, { capture: true });
    window.addEventListener('unhandledrejection', onUnhandledRejection, { capture: true });
    return () => {
      window.removeEventListener('error', onError, { capture: true } as EventListenerOptions);
      window.removeEventListener('unhandledrejection', onUnhandledRejection, {
        capture: true,
      } as EventListenerOptions);
    };
  }, []);
  return null;
}