'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatDateTime } from '@/lib/format/datetime';
import type { TimezoneId } from '@/lib/timezone/registry';
import { adminFetch } from '@/lib/api/admin-fetch';
import { fetchCsrfToken } from '@/lib/csrf/client';
import { AdminSchedulerControls } from '@/app/admin/_components/admin-scheduler-controls';

interface Repo {
  id: string;
  owner: string;
  name: string;
}

interface Props {
  isPaused: boolean;
  pausedAt: string | null;
  tz: TimezoneId;
  repos: Repo[];
}

/**
 * Client component for /admin/refresh (M7.6, M30 task 4).
 *
 * Owns:
 *   1. Manual refresh trigger form — repo <select> + submit button. Calls
 *      /api/admin/refresh with action=trigger.
 *   2. Scheduler pause/resume chip — delegated to the
 *      `AdminSchedulerControls` atom so the chip + button is rendered
 *      consistently with the rest of the admin surface (M30 task 4).
 *   3. The pausedAt timestamp + multi-process note.
 *
 * CSRF: adminFetch injects the x-csrf-token header. The route schema
 * also requires csrf as a body field, which we provide via
 * fetchCsrfToken().
 *
 * On success, calls `router.refresh()` so the parent server component
 * re-renders with the updated scheduler state and pending-jobs list.
 */
export function RefreshControls({ isPaused, pausedAt, repos, tz }: Props) {
  const tTrigger = useTranslations('admin.refresh.trigger');
  const tSched = useTranslations('admin.refresh.scheduler');
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoId, setRepoId] = useState('');

  async function postAction(body: Record<string, unknown>): Promise<void> {
    setSubmitting(true);
    try {
      const csrf = await fetchCsrfToken();
      await adminFetch('/api/admin/refresh', {
        method: 'POST',
        body: { ...body, csrf },
      });
      router.refresh();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const detail = message.startsWith('adminFetch ')
        ? message.split('adminFetch ')[1] ?? message
        : message;
      setError(detail);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTrigger(): Promise<void> {
    setError(null);
    if (!repoId) {
      setError(tTrigger('selectRepoError'));
      return;
    }
    setRepoId('');
    await postAction({ action: 'trigger', repoId });
  }

  return (
    <div className="space-y-4">
      {/* Trigger form */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">{tTrigger('heading')}</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-sm">
            <span className="text-gray-600">{tTrigger('repoLabel')}</span>
            <select
              name="repoId"
              value={repoId}
              onChange={(e) => setRepoId(e.target.value)}
              className="mt-1 rounded border border-gray-300 px-2 py-1"
              disabled={submitting}
            >
              <option value="" disabled>
                {tTrigger('selectPlaceholder')}
              </option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {tTrigger('repoOption', { id: r.id, owner: r.owner, name: r.name })}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleTrigger}
            disabled={submitting}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {tTrigger('submit')}
          </button>
        </div>
      </div>

      {/* Pause/resume — chip + button delegated to AdminSchedulerControls */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">{tSched('heading')}</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-600">{tSched('multiProcessNote')}</div>
            {pausedAt ? (
              <div className="text-xs text-gray-500">
                {tSched('pausedAt', { timestamp: formatDateTime(pausedAt, tz) })}
              </div>
            ) : null}
          </div>
          <AdminSchedulerControls currentState={isPaused ? 'PAUSED' : 'RUNNING'} />
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}