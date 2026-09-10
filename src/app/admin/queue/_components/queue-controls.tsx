'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatDateTime } from '@/lib/format/datetime';
import type { TimezoneId } from '@/lib/timezone/registry';
import { adminFetch } from '@/lib/api/admin-fetch';
import { fetchCsrfToken } from '@/lib/csrf/client';

interface Props {
  isPaused: boolean;
  pausedAt: string | null;
  tz: TimezoneId;
}

/**
 * M20.7 — /admin/queue controls (client island).
 *
 * Two responsibilities:
 *   1. "Run tick now" button → POST /api/admin/queue/tick (admin-only,
 *      CSRF-guarded). Result is shown inline as a single-line summary.
 *   2. Auto-refresh the parent server component every 2s via
 *      router.refresh() so the queue tables stay live without manual reload.
 *
 * CSRF: adminFetch injects the x-csrf-token header. The route also
 * validates body.csrf, which we provide via fetchCsrfToken().
 */
export function QueueControls({ isPaused, pausedAt, tz }: Props): ReactElement {
  const t = useTranslations('admin.queue.controls');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true; claimed: number; done: number; pending: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-refresh the page every 2s so the queue tables + KPIs stay live.
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), 2000);
    return () => window.clearInterval(id);
  }, [router]);

  async function handleRunTick(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const csrf = await fetchCsrfToken();
      const data = await adminFetch<{
        ok: true;
        claimed: number;
        done: number;
        pending: number;
        failed: number;
      }>('/api/admin/queue/tick', {
        method: 'POST',
        body: { csrf },
      });
      setResult(data);
      // Re-fetch the page so the per-status sections + KPIs reflect the tick.
      router.refresh();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const detail = message.startsWith('adminFetch ')
        ? message.split('adminFetch ')[1] ?? message
        : message;
      setError(detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t('heading')}</h2>
          <p className="mt-1 text-sm text-gray-500">{t('hint')}</p>
          <p className="mt-1 text-xs text-gray-400">{t('autoRefresh')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-600">
            {t('schedulerLabel')}{' '}
            <span
              className={
                isPaused ? 'font-semibold text-red-600' : 'font-semibold text-green-600'
              }
            >
              {isPaused ? t('paused') : t('running')}
            </span>
            {isPaused && pausedAt !== null ? (
              <span className="ml-2 text-xs text-gray-500">
                {t('pausedAt', { when: formatDateTime(pausedAt, tz) })}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => void handleRunTick()}
            disabled={busy || isPaused}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? t('running') : t('runTickButton')}
          </button>
        </div>
      </div>
      {result !== null ? (
        <p className="mt-3 text-sm text-gray-700">
          {t('tickSummary', {
            claimed: result.claimed,
            done: result.done,
            pending: result.pending,
            failed: result.failed,
          })}
        </p>
      ) : null}
      {error !== null ? (
        <p className="mt-3 text-sm text-red-700">
          {t('failed', { error })}
        </p>
      ) : null}
    </div>
  );
}