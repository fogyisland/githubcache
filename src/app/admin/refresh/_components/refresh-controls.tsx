'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatDateTime } from '@/lib/format/datetime';
import type { TimezoneId } from '@/lib/timezone/registry';

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
 * Client component for /admin/refresh (M7.6).
 *
 * Owns three controls:
 *   1. Manual refresh trigger form — repo <select> + submit button. Calls
 *      /api/admin/refresh with action=trigger.
 *   2. Scheduler pause button — action=pause (rendered when running).
 *   3. Scheduler resume button — action=resume (rendered when paused).
 *
 * CSRF: fetches /api/admin/auth/csrf, then echoes the token in the
 * `x-csrf-token` header (M7.1 pattern).
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

  async function postCsrf(body: Record<string, unknown>): Promise<Response> {
    const csrfRes = await fetch('/api/admin/auth/csrf', { credentials: 'same-origin' });
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    return fetch('/api/admin/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      // Send csrf in body too — route schemas require it as a body field
      // (defense-in-depth on top of the middleware header check).
      body: JSON.stringify({ ...body, csrf: csrfToken }),
    });
  }

  async function handleTrigger(): Promise<void> {
    setError(null);
    if (!repoId) {
      setError(tTrigger('selectRepoError'));
      return;
    }
    setSubmitting(true);
    const res = await postCsrf({ action: 'trigger', repoId });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
      setSubmitting(false);
      return;
    }
    setRepoId('');
    router.refresh();
    setSubmitting(false);
  }

  async function handlePause(): Promise<void> {
    setError(null);
    setSubmitting(true);
    const res = await postCsrf({ action: 'pause' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
      setSubmitting(false);
      return;
    }
    router.refresh();
    setSubmitting(false);
  }

  async function handleResume(): Promise<void> {
    setError(null);
    setSubmitting(true);
    const res = await postCsrf({ action: 'resume' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
      setSubmitting(false);
      return;
    }
    router.refresh();
    setSubmitting(false);
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

      {/* Pause/resume */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">{tSched('heading')}</h2>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">
              {tSched('statusLabel')}{' '}
              <span
                className={
                  isPaused ? 'font-semibold text-red-600' : 'font-semibold text-green-600'
                }
              >
                {isPaused ? tSched('paused') : tSched('running')}
              </span>
            </div>
            {pausedAt && (
              <div className="text-xs text-gray-500">
                {tSched('pausedAt', { timestamp: formatDateTime(pausedAt, tz) })}
              </div>
            )}
            <div className="mt-1 text-xs text-gray-500">
              {tSched('multiProcessNote')}
            </div>
          </div>
          <div>
            {isPaused ? (
              <button
                type="button"
                onClick={handleResume}
                disabled={submitting}
                className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {tSched('resume')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePause}
                disabled={submitting}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {tSched('pause')}
              </button>
            )}
          </div>
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
