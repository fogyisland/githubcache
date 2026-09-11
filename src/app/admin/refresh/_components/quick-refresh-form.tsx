'use client';

import { useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { adminFetch } from '@/lib/api/admin-fetch';

/**
 * Inline "refresh this repo" form for /admin/refresh.
 *
 * Lets the operator type `owner/name` and enqueue a manual refresh job
 * without opening the repo picker. The form resolves the slug to a
 * repository id via the public v1 API; if that fails we surface the
 * error inline. On success we trigger a `router.refresh()` so the
 * pending-jobs list and KPI tiles re-fetch.
 *
 * The full repo-picker form still lives in `RefreshControls` for ops who
 * want to search by id or pick from a recent set.
 */
export function QuickRefreshForm(): ReactElement {
  const t = useTranslations('admin.refresh.quickRefresh');
  const router = useRouter();
  const [slug, setSlug] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (pending) return;
    setError(null);
    setQueued(null);
    const trimmed = slug.trim();
    const match = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed);
    if (!match) {
      setError(t('invalid'));
      return;
    }
    const owner = match[1] ?? '';
    const name = match[2] ?? '';
    if (!owner || !name) {
      setError(t('invalid'));
      return;
    }
    setPending(true);
    try {
      // Resolve owner/name to repoId via the public v1 endpoint. This
      // keeps the quick-refresh form decoupled from any admin-side
      // repo list.
      const metaRes = await fetch(`/api/v1/repos/${owner}/${name}`, {
        credentials: 'include',
      });
      if (!metaRes.ok) {
        setError(`HTTP ${metaRes.status}`);
        setPending(false);
        return;
      }
      const meta = (await metaRes.json()) as { id?: unknown };
      const repoId =
        typeof meta.id === 'string' || typeof meta.id === 'number'
          ? String(meta.id)
          : null;
      if (!repoId) {
        setError('repo not found');
        setPending(false);
        return;
      }
      await adminFetch('/api/admin/refresh', {
        method: 'POST',
        body: { action: 'trigger', repoId },
      });
      setQueued(t('queued', { owner, name }));
      setSlug('');
      router.refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(t('failed', { error: msg }));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="ghc-admin-quick-refresh"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="ghc-admin-quick-refresh-label">
        <span className="ghc-admin-quick-refresh-text">owner/name</span>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder={t('placeholder')}
          className="ghc-admin-quick-refresh-input"
          disabled={pending}
        />
      </label>
      <button
        type="submit"
        disabled={pending || slug.trim() === ''}
        className="ghc-btn-primary"
      >
        {t('submit')}
      </button>
      {error ? (
        <span className="ghc-admin-quick-refresh-error" role="alert">
          {error}
        </span>
      ) : null}
      {queued ? (
        <span className="ghc-admin-quick-refresh-ok" role="status">
          {queued}
        </span>
      ) : null}
    </form>
  );
}
