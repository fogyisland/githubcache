'use client';

import { useState, useTransition, useRef, useEffect, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { rotateOwnKeyAction } from '@/app/account/keys/[id]/_actions/rotate';

interface Props {
  keyId: string;
  oldKeyName: string;
}

/**
 * M31.x — "Rotate key" button + reveal modal.
 *
 * Click flow:
 *   1. Confirm the user understands the old key will be revoked.
 *   2. Call the server action. On success we receive the new plaintext
 *      ONE TIME.
 *   3. Open the modal showing the plaintext + a Copy button.
 *   4. The plaintext lives in component state only — once the modal
 *      is closed (Done / backdrop click) we wipe it so it can't be
 *      recovered from the DOM.
 *
 * Server-side errors map to friendly messages via the i18n table.
 * The 24h cooldown maps to a distinct error so the user knows it's
 * temporary, not a bug.
 */
export function RotateOwnKeyButton({ keyId, oldKeyName }: Props): ReactElement {
  const t = useTranslations('account.keys.detail.rotate');
  const tErrors = useTranslations('account.keys.detail.rotateErrors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [phase, setPhase] = useState<'idle' | 'revealing' | 'done'>('idle');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wipe the plaintext + clear any pending copy toast when the modal
  // closes. Defensive — the parent passes `open=false` and we sync.
  useEffect(() => {
    if (phase === 'done') return;
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [phase]);

  function onClickRotate(): void {
    if (!window.confirm(t('confirm', { name: oldKeyName }))) return;
    setErrorKey(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('keyId', keyId);
      const result = await rotateOwnKeyAction(fd);
      if (!result.ok) {
        setErrorKey(result.error);
        return;
      }
      setPlaintext(result.plaintext);
      setPhase('revealing');
    });
  }

  async function onCopy(): Promise<void> {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard.writeText can reject if permissions are denied
      // (e.g. insecure context, iframe). Fall back to selecting the
      // text so the user can still Ctrl+C.
      const sel = window.getSelection();
      const range = document.createRange();
      const node = document.getElementById('ghc-rotate-plaintext');
      if (sel && node) {
        range.selectNodeContents(node);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  function onDone(): void {
    setPhase('idle');
    setPlaintext(null);
    setCopied(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        className="ghc-btn-primary ghc-btn-sm"
        disabled={pending}
        onClick={onClickRotate}
        aria-label={t('aria', { name: oldKeyName })}
      >
        {pending ? t('rotating') : t('button')}
      </button>
      {errorKey ? (
        <span className="ghc-text-danger" role="alert" style={{ marginLeft: '0.5rem' }}>
          {tErrors(errorKey as 'not_signed_in' | 'forbidden' | 'not_found' | 'not_active' | 'rate_limited' | 'invalid')}
        </span>
      ) : null}
      {phase === 'revealing' && plaintext ? (
        <div
          className="ghc-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ghc-rotate-title"
          onClick={(e) => {
            // Backdrop click dismisses — but NOT clicks inside the panel
            if (e.target === e.currentTarget) onDone();
          }}
        >
          <div className="ghc-modal-panel" style={{ maxWidth: '36rem' }}>
            <h3 id="ghc-rotate-title" className="font-semibold text-lg">
              {t('modal.title')}
            </h3>
            <p className="mt-2 text-sm" style={{ color: '#b91c1c' }}>
              {t('modal.warning')}
            </p>
            <div className="mt-4 flex items-stretch gap-2">
              <code
                id="ghc-rotate-plaintext"
                className="ghc-input-mono"
                style={{ flex: 1, padding: '0.5rem 0.75rem', wordBreak: 'break-all', fontSize: '0.85rem' }}
              >
                {plaintext}
              </code>
              <button
                type="button"
                className="ghc-btn-primary ghc-btn-sm"
                onClick={() => void onCopy()}
                aria-live="polite"
              >
                {copied ? t('modal.copied') : t('modal.copy')}
              </button>
            </div>
            <p className="mt-3 text-xs ghc-text-muted">{t('modal.hint')}</p>
            <div className="mt-4 flex justify-end">
              <button type="button" className="ghc-btn-secondary ghc-btn-sm" onClick={onDone}>
                {t('modal.done')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
