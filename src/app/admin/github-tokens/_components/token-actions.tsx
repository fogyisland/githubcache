'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { GithubTokenStatus } from '@prisma/client';
import type { ReactElement } from 'react';
import { fetchCsrfToken } from '@/lib/csrf/client';
import { AdminConfirmDialog } from '@/app/admin/_components/admin-confirm-dialog';

/**
 * M32.5 — Per-row action buttons for /admin/github-tokens.
 *
 * Mirrors the standard ghc-btn-* look: status toggle (Enable / Disable)
 * + delete via AdminConfirmDialog. Was previously rendered as
 * terminal-frame keycaps (`[d] [E] [x]`) when this page wore its dark
 * terminal look; M32.5 retired that styling.
 */
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
    void fetchCsrfToken().then(setCsrf).catch(() => undefined);
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
    <div className="ghc-admin-row-actions">
      <button
        type="button"
        className={currentStatus === 'active' ? 'ghc-btn-secondary' : 'ghc-btn-primary'}
        onClick={() => void patchStatus(currentStatus === 'active' ? 'disabled' : 'active')}
        disabled={busy || !csrf}
        aria-label={currentStatus === 'active' ? t('disable') : t('enable')}
      >
        {currentStatus === 'active' ? t('disable') : t('enable')}
      </button>
      <AdminConfirmDialog
        triggerLabel={t('delete')}
        title={t('confirmDelete')}
        description={tokenId}
        confirmLabel={t('delete')}
        action={async () => {
          await deleteToken();
        }}
        triggerClassName="ghc-btn-danger"
      />
      {message ? <span className="ghc-admin-meta">{message}</span> : null}
    </div>
  );
}