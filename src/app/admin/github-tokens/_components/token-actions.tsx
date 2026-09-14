'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { GithubTokenStatus } from '@prisma/client';
import type { ReactElement } from 'react';
import { fetchCsrfToken } from '@/lib/csrf/client';

const CONFIRM_TIMEOUT_MS = 5_000;

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
  const [confirming, setConfirming] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);

  useEffect(() => {
    void fetchCsrfToken().then(setCsrf).catch(() => undefined);
  }, []);

  const clearConfirmTimer = useCallback(() => {
    if (confirmTimerRef.current !== null) {
      window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearConfirmTimer(), [clearConfirmTimer]);

  function startConfirm(): void {
    clearConfirmTimer();
    setConfirming(true);
    setMessage(null);
    confirmTimerRef.current = window.setTimeout(() => {
      setConfirming(false);
      confirmTimerRef.current = null;
    }, CONFIRM_TIMEOUT_MS);
  }

  function cancelConfirm(): void {
    clearConfirmTimer();
    setConfirming(false);
  }

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
    cancelConfirm();
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(t('failedWithError', { error: err.error ?? String(res.status) }));
      return;
    }
    setMessage(t('deletedOk'));
    router.refresh();
  }

  if (confirming) {
    return (
      <div
        className="ghc-term-confirm"
        role="alertdialog"
        aria-labelledby={`confirm-${tokenId}-title`}
        aria-describedby={`confirm-${tokenId}-desc`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancelConfirm();
        }}
      >
        <span id={`confirm-${tokenId}-title`}>
          <span className="ghc-term-prompt">$</span>
          {t('confirmDelete')}
        </span>
        <span id={`confirm-${tokenId}-desc`} className="ghc-term-dim">
          {tokenId}
        </span>
        <button
          type="button"
          className="ghc-term-keycap"
          data-variant="err"
          onClick={() => void deleteToken()}
          disabled={busy || !csrf}
          autoFocus
        >
          [y]
        </button>
        <button
          type="button"
          className="ghc-term-keycap"
          onClick={cancelConfirm}
          disabled={busy}
          autoFocus={false}
        >
          [N]
        </button>
      </div>
    );
  }

  return (
    <div className="ghc-term-actions">
      <button
        type="button"
        className="ghc-term-keycap"
        data-variant="warn"
        onClick={() => void patchStatus(currentStatus === 'active' ? 'disabled' : 'active')}
        disabled={busy || !csrf}
        aria-label={currentStatus === 'active' ? t('disable') : t('enable')}
      >
        [{currentStatus === 'active' ? 'd' : 'E'}]
      </button>
      <button
        type="button"
        className="ghc-term-keycap"
        data-variant="err"
        onClick={startConfirm}
        disabled={busy || !csrf}
        aria-label={t('delete')}
      >
        [x]
      </button>
      {message ? <span className="ghc-term-dim">{message}</span> : null}
    </div>
  );
}
