'use client';

import { useState, useEffect, useRef, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { adminFetch } from '@/lib/api/admin-fetch';

interface Props {
  currentState: 'RUNNING' | 'PAUSED';
}

/**
 * Client atom — sticky pause/resume chip + button for the scheduler.
 *
 * Replaces the legacy in-page scheduler state row on /admin/refresh with a
 * self-contained client island that flips the bit via the existing
 * /api/admin/refresh route (action=pause|resume). The state displayed
 * starts from the SSR-supplied `currentState` and is updated optimistically
 * after a successful round-trip.
 *
 * `pause()` / `resume()` from the scheduler module are process-local — the
 * route does not require additional wiring beyond the existing POST. The
 * chip colour mirrors AdminStatusChip (ok=green, warn=amber).
 */
export function AdminSchedulerControls({ currentState: initial }: Props): ReactElement {
  const t = useTranslations('admin.refresh.controls');
  const [state, setState] = useState<'RUNNING' | 'PAUSED'>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevInitial = useRef(initial);

  // If the SSR-rendered state differs from the local one (e.g. the parent
  // re-fetched via router.refresh, or another admin paused the scheduler
  // in a different tab), keep them aligned. We track `initial` across
  // renders and only call setState when it actually changes — local
  // optimistic toggles are not overwritten unless the server confirms.
  useEffect(() => {
    if (prevInitial.current !== initial) {
      prevInitial.current = initial;
      setState(initial);
    }
  }, [initial]);

  async function toggle(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    const next: 'RUNNING' | 'PAUSED' = state === 'RUNNING' ? 'PAUSED' : 'RUNNING';
    try {
      await adminFetch('/api/admin/refresh', {
        method: 'POST',
        body: { action: next === 'PAUSED' ? 'pause' : 'resume' },
      });
      setState(next);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ghc-admin-scheduler-controls" data-state={state}>
      <span
        data-state={state}
        className={`ghc-admin-chip ghc-admin-chip-${state === 'RUNNING' ? 'ok' : 'warn'}`}
      >
        {state === 'RUNNING' ? t('running') : t('paused')}
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="ghc-btn-primary"
        aria-label={state === 'RUNNING' ? t('pause') : t('resume')}
      >
        {pending ? t('pending') : state === 'RUNNING' ? t('pause') : t('resume')}
      </button>
      {error ? (
        <span className="ghc-admin-scheduler-controls-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
