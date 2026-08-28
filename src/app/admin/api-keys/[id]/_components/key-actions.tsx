'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

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
    void fetch('/api/admin/auth/csrf')
      .then((r) => r.json())
      .then((d: { csrfToken: string }) => setCsrf(d.csrfToken));
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