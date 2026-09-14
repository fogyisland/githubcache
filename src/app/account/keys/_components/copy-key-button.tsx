'use client';

import { useState, useTransition, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { revealOwnKeyAction } from '@/app/account/keys/_actions/reveal';

interface Props {
  keyId: string;
  keyName: string;
  available: boolean;
}

/**
 * M31.x — Inline "Copy" button on /account/keys list row.
 *
 * On click: call revealOwnKeyAction → write plaintext to clipboard.
 * Graceful fallback when:
 *   - `available=false` (row predates plaintext_key column): button is
 *     disabled with a tooltip telling the user to rotate.
 *   - server returns `no_plaintext`: same UX as `available=false`.
 *   - server returns `rate_limited`: show a transient warning.
 *   - clipboard.writeText rejects (insecure context, etc.): fall
 *     back to showing the plaintext in an alert-style banner for the
 *     user to copy manually.
 */
export function CopyKeyButton({ keyId, keyName, available }: Props): ReactElement {
  const t = useTranslations('account.keys.listActions');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [phase, setPhase] = useState<'idle' | 'copied' | 'warning' | 'showPlaintext'>('idle');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  function onClick(): void {
    setWarning(null);
    setPlaintext(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('keyId', keyId);
      const result = await revealOwnKeyAction(fd);
      if (!result.ok) {
        if (result.error === 'rate_limited') {
          setWarning(t('rateLimited'));
        } else if (result.error === 'no_plaintext' || result.error === 'not_found') {
          setWarning(t('copyUnavailable'));
        } else {
          setWarning(t('revealFailed'));
        }
        setPhase('warning');
        return;
      }
      try {
        await navigator.clipboard.writeText(result.plaintext);
        setPhase('copied');
        setTimeout(() => setPhase('idle'), 2000);
      } catch {
        // Insecure context (no clipboard permission) — show plaintext
        // inline so the user can Ctrl+C.
        setPlaintext(result.plaintext);
        setPhase('showPlaintext');
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="ghc-btn-secondary ghc-btn-sm"
          onClick={onClick}
          disabled={!available || pending}
          aria-label={t('copyAria', { name: keyName })}
          aria-busy={pending}
          title={!available ? t('copyUnavailable') : undefined}
        >
          {pending ? t('copying') : phase === 'copied' ? t('copied') : t('copy')}
        </button>
        <a
          href={`/account/keys/${keyId}`}
          className="ghc-btn-secondary ghc-btn-sm"
          aria-label={t('rotateAria', { name: keyName })}
        >
          {t('rotate')}
        </a>
      </div>
      {warning ? (
        <span className="ghc-text-danger" style={{ fontSize: '0.75rem' }}>
          {warning}
        </span>
      ) : null}
      {phase === 'showPlaintext' && plaintext ? (
        <code
          className="ghc-input-mono"
          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', wordBreak: 'break-all' }}
        >
          {plaintext}
        </code>
      ) : null}
    </div>
  );
}