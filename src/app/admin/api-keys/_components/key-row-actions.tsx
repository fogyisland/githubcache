'use client';

import { useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { adminFetch } from '@/lib/api/admin-fetch';

/**
 * M28 — inline Approve / Reject / Revoke buttons for the API key list.
 *
 * Replaces the old flow where the operator had to click into the
 * detail page to act on a key. Both endpoints already exist
 * (POST /api/admin/api-keys/[id]/approve and /revoke); this
 * component just calls them and refreshes the table.
 *
 * adminFetch owns CSRF + credentials + JSON encoding. CSRF is fetched
 * lazily per call; no up-front probe needed.
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
  const [busy, setBusy] = useState<'approve' | 'reject' | 'revoke' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(
    endpoint: 'approve' | 'reject' | 'revoke',
    confirmMessage?: string,
  ): Promise<void> {
    if (confirmMessage && !window.confirm(confirmMessage)) {
      return;
    }
    setBusy(endpoint);
    setError(null);
    try {
      await adminFetch(`/api/admin/api-keys/${apiKeyId}/${endpoint}`, {
        method: 'POST',
      });
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown';
      const match = /^adminFetch (\d+):\s*(.*)$/.exec(message);
      if (match) {
        const status = Number(match[1]);
        const bodyText = match[2] ?? '';
        let parsedError: string | undefined;
        try {
          const parsed = JSON.parse(bodyText) as { error?: string };
          parsedError = parsed.error;
        } catch {
          // body wasn't JSON; fall through to status-based message
        }
        setError(parsedError ?? `HTTP ${status}`);
      } else {
        setError(message);
      }
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