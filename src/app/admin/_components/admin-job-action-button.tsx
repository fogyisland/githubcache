'use client';

import { useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { adminFetch } from '@/lib/api/admin-fetch';

interface Props {
  jobId: string;
  action: 'retry' | 'cancel';
}

/**
 * Client atom — inline Retry / Cancel button for a single refresh job
 * card on /admin/queue. Calls `POST /api/admin/refresh-jobs/[id]/[action]`,
 * which mutates the row's status. On success we trigger a soft refresh
 * of the parent route (router.refresh) so the card grid re-renders with
 * the updated server data.
 */
export function AdminJobActionButton({ jobId, action }: Props): ReactElement {
  const t = useTranslations('admin.queue');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/refresh-jobs/${jobId}/${action}`, {
        method: 'POST',
      });
      // Soft-revalidate so the parent server component re-fetches the
      // queue and the card flips to its new status (or disappears).
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className={`ghc-btn-ghost ghc-btn-${action}`}
      title={error ?? undefined}
    >
      {t(`${action}.btn`)}
    </button>
  );
}
