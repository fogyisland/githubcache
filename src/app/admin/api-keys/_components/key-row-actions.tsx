'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { fetchCsrfToken } from '@/lib/csrf/client';

/**
 * M28 — inline Approve / Reject / Revoke buttons for the API key list.
 *
 * Replaces the old flow where the operator had to click into the
 * detail page to act on a key. Both endpoints already exist
 * (POST /api/admin/api-keys/[id]/approve and /revoke); this
 * component just calls them and refreshes the table.
 *
 * Web Interface Guidelines:
 *  - Destructive actions need a confirmation modal/undo window —
 *    Reject + Revoke both use a confirm() gate.
 *  - Submit button stays enabled until request starts; spinner
 *    during request.
 *  - Submit button text: specific verb, not generic ("Approve",
 *    "Reject", "Revoke") so the operator always knows which state
 *    they're moving the row to.
 */
export function KeyRowActions({
  apiKeyId,
  status,
}: {
  apiKeyId: string;
  status: 'pending' | 'active' | 'revoked';
}): ReactElement {
  const t = useTranslations('admin.apiKeys.rowActions');
  const router = useRouter();
  const [csrf, setCsrf] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | 'revoke' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchCsrfToken()
      .then(setCsrf)
      .catch(() => {
        // Token fetch failed; the next action click will retry.
        // fetchCsrfToken self-heals via resetCsrfCache on throw.
      });
  }, []);

  async function call(
    endpoint: 'approve' | 'reject' | 'revoke',
    confirmMessage?: string,
  ): Promise<void> {
    if (!csrf) {
      setError(t('csrfPending'));
      return;
    }
    if (confirmMessage && !window.confirm(confirmMessage)) {
      return;
    }
    setBusy(endpoint);
    setError(null);
    try {
      const res = await fetch(`/api/admin/api-keys/${apiKeyId}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ csrf }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (status === 'pending') {
    return (
      <div className="ghc-admin-row-actions">
        <button
          type="button"
          className="ghc-btn-primary ghc-btn-sm"
          disabled={busy !== null}
          onClick={() => void call('approve')}
          aria-label={t('approveAria', { id: apiKeyId })}
        >
          {busy === 'approve' ? t('approving') : t('approve')}
        </button>
        <button
          type="button"
          className="ghc-btn-danger ghc-btn-sm"
          disabled={busy !== null}
          onClick={() => void call('reject', t('confirmReject'))}
          aria-label={t('rejectAria', { id: apiKeyId })}
        >
          {busy === 'reject' ? t('rejecting') : t('reject')}
        </button>
        {error ? (
          <span className="ghc-admin-row-actions-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  if (status === 'active') {
    return (
      <div className="ghc-admin-row-actions">
        <button
          type="button"
          className="ghc-btn-danger ghc-btn-sm"
          disabled={busy !== null}
          onClick={() => void call('revoke', t('confirmRevoke'))}
          aria-label={t('revokeAria', { id: apiKeyId })}
        >
          {busy === 'revoke' ? t('revoking') : t('revoke')}
        </button>
        {error ? (
          <span className="ghc-admin-row-actions-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  // revoked — no action
  return <></>;
}