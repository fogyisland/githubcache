'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { GithubTokenStatus } from '@prisma/client';
import type { ReactElement } from 'react';

export function TokenActions({
  tokenId,
  currentStatus,
}: {
  tokenId: string;
  currentStatus: GithubTokenStatus;
}): ReactElement {
  const t = useTranslations('admin.githubTokens.actions');
  const router = useRouter();
  const [csrf, setCsrf] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/admin/auth/csrf')
      .then((r) => r.json())
      .then((d: { csrfToken: string }) => setCsrf(d.csrfToken));
  }, []);

  async function patchStatus(status: GithubTokenStatus): Promise<void> {
    if (!csrf) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/github-tokens/${tokenId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ status, csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(t('failedWithError', { error: err.error ?? String(res.status) }));
      return;
    }
    setMessage(status === 'disabled' ? t('disabledOk') : t('enabledOk'));
    router.refresh();
  }

  async function deleteToken(): Promise<void> {
    if (!csrf) return;
    if (!confirm(t('confirmDelete'))) {
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/github-tokens/${tokenId}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(t('failedWithError', { error: err.error ?? String(res.status) }));
      return;
    }
    setMessage(t('deletedOk'));
    router.refresh();
  }

  return (
    <div>
      <button
        onClick={() => void patchStatus(currentStatus === 'active' ? 'disabled' : 'active')}
        disabled={busy || !csrf}
      >
        {currentStatus === 'active' ? t('disable') : t('enable')}
      </button>
      <button onClick={() => void deleteToken()} disabled={busy || !csrf}>
        {t('delete')}
      </button>
      {message && <p>{message}</p>}
    </div>
  );
}
