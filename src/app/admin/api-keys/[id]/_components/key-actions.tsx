'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

/**
 * Module-level shared CSRF fetch. Multiple KeyActions instances on the
 * same page (and across pages during HMR / multi-tab) all await the
 * SAME in-flight fetch — so we don't issue N parallel /api/admin/auth/csrf
 * calls, each of which rotates the cookie server-side, leaving the
 * React state of the last-mounted instance out of sync with the
 * persisted cookie. The browser sees one consistent (cookie, token)
 * pair per page load.
 */
let csrfInflight: Promise<string> | null = null;
function getCsrfToken(): Promise<string> {
  if (csrfInflight) return csrfInflight;
  csrfInflight = fetch('/api/admin/auth/csrf', { credentials: 'include' })
    .then((r) => {
      if (!r.ok) throw new Error(`csrf HTTP ${r.status}`);
      return r.json() as Promise<{ csrfToken?: string }>;
    })
    .then((d) => {
      if (!d.csrfToken) throw new Error('csrf missing in body');
      return d.csrfToken;
    })
    .finally(() => {
      // Allow subsequent calls to refresh the token after the current
      // burst settles (each new burst after this one will refetch).
      setTimeout(() => {
        csrfInflight = null;
      }, 0);
    });
  return csrfInflight;
}

export function KeyActions({
  apiKeyId,
  currentStatus,
}: {
  apiKeyId: string;
  currentStatus: 'pending' | 'active' | 'revoked';
}): ReactElement {
  const t = useTranslations('admin.apiKeys.actions');
  const router = useRouter();
  const [csrf, setCsrf] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void getCsrfToken()
      .then(setCsrf)
      .catch(() => {
        // Token fetch failed. Reset the shared inflight so a retry
        // path (e.g. user re-mounts or another instance retries)
        // can fetch fresh.
        csrfInflight = null;
      });
  }, []);

  async function callApprove(): Promise<void> {
    if (!csrf) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/api-keys/${apiKeyId}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(t('approveFailed', { error: err.error ?? String(res.status) }));
      return;
    }
    setMessage(t('approvedOk'));
    router.refresh();
  }

  async function callRevoke(): Promise<void> {
    if (!csrf) return;
    if (!confirm(t('confirmRevoke'))) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/api-keys/${apiKeyId}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(t('revokeFailed', { error: err.error ?? String(res.status) }));
      return;
    }
    setMessage(t('revokedOk'));
    router.refresh();
  }

  return (
    <div>
      {currentStatus === 'pending' && (
        <button onClick={() => void callApprove()} disabled={busy || !csrf}>
          {t('approve')}
        </button>
      )}
      {currentStatus === 'active' && (
        <button onClick={() => void callRevoke()} disabled={busy || !csrf}>
          {t('revoke')}
        </button>
      )}
      {currentStatus === 'revoked' && <em>{t('alreadyRevoked')}</em>}
      {message && <p>{message}</p>}
    </div>
  );
}