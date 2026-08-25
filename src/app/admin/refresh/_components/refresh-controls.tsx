'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Repo {
  id: string;
  owner: string;
  name: string;
}

interface Props {
  isPaused: boolean;
  pausedAt: string | null;
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
export function RefreshControls({ isPaused, pausedAt, repos }: Props) {
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
      body: JSON.stringify(body),
    });
  }

  async function handleTrigger(): Promise<void> {
    setError(null);
    if (!repoId) {
      setError('Please select a repository.');
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
        <h2 className="mb-3 text-lg font-semibold">Trigger manual refresh</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-sm">
            <span className="text-gray-600">Repository</span>
            <select
              name="repoId"
              value={repoId}
              onChange={(e) => setRepoId(e.target.value)}
              className="mt-1 rounded border border-gray-300 px-2 py-1"
              disabled={submitting}
            >
              <option value="" disabled>
                Select a repository…
              </option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  #{r.id} — {r.owner}/{r.name}
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
            Trigger refresh
          </button>
        </div>
      </div>

      {/* Pause/resume */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Scheduler state</h2>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">
              Status:{' '}
              <span
                className={
                  isPaused ? 'font-semibold text-red-600' : 'font-semibold text-green-600'
                }
              >
                {isPaused ? 'PAUSED' : 'RUNNING'}
              </span>
            </div>
            {pausedAt && (
              <div className="text-xs text-gray-500">
                Paused at: {new Date(pausedAt).toISOString()}
              </div>
            )}
            <div className="mt-1 text-xs text-gray-500">
              Note: pause is process-local. Multi-process deployments require DB-backed pause
              (out of scope per M5.5).
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
                Resume
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePause}
                disabled={submitting}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Pause
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
