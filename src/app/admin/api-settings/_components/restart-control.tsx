'use client';

import { useState, useEffect, useRef, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { adminFetch } from '@/lib/api/admin-fetch';

/**
 * Restart service control. Inline card on /admin/api-settings that opens
 * a confirm modal, asks for the literal phrase "restart", then fires
 * POST /api/admin/system/restart. Submission is silent: the user sees a
 * short "Restart initiated" notice but we don't auto-refresh or poll —
 * the page will naturally break when the process exits, and the
 * operator verifies via /api/v1/status afterwards.
 *
 * Why a phrase: prevents an accidental click from taking the service
 * down. The route checks `confirm === "restart"` exactly; matches the
 * "you must type to confirm" pattern used elsewhere.
 */
export function RestartControl(): ReactElement {
  const t = useTranslations('admin.apiSettings');
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus the input when the modal opens so the user can type
  // immediately. focus the button on close so keyboard users land on
  // the trigger again.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // Esc closes the modal — but only when not actively submitting
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !submitting) close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, submitting]);

  function close(): void {
    setOpen(false);
    setPhrase('');
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    if (phrase !== 'restart') {
      setError(t('restart.confirmMismatch'));
      return;
    }

    setSubmitting(true);
    try {
      await adminFetch('/api/admin/system/restart', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'restart' }),
      });
      // Don't try to do anything after — the process will exit shortly.
      setSubmitted(true);
    } catch (err) {
      // The fetch may reject because the process actually exits before
      // the response flushes. That's success, not failure.
      const msg = err instanceof Error ? err.message : String(err);
      if (/restart|exit|aborted|fetch failed/i.test(msg)) {
        setSubmitted(true);
        return;
      }
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className="ghc-restart-control">
      <div className="ghc-restart-control-row">
        <button
          type="button"
          className="ghc-btn-danger"
          onClick={() => setOpen(true)}
          disabled={submitting || submitted}
        >
          {t('restart.button')}
        </button>
        {submitted ? (
          <span className="ghc-restart-toast" role="status">
            {t('restart.submitted')}
          </span>
        ) : null}
      </div>

      {open ? (
        <div
          className="ghc-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ghc-restart-modal-title"
          onClick={(e) => {
            // Click on backdrop closes — but not on the dialog body itself
            if (e.target === e.currentTarget && !submitting) close();
          }}
        >
          <div className="ghc-modal" role="document">
            <h2 id="ghc-restart-modal-title" className="ghc-modal-title">
              {t('restart.modalTitle')}
            </h2>
            <p className="ghc-modal-body">{t('restart.modalBody')}</p>

            <form onSubmit={onSubmit} className="ghc-modal-form">
              <input
                ref={inputRef}
                type="text"
                className="ghc-modal-input"
                placeholder={t('restart.confirmPlaceholder')}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={submitting}
              />

              {error !== null ? (
                <p className="ghc-modal-error" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="ghc-modal-actions">
                <button
                  type="button"
                  className="ghc-btn-ghost"
                  onClick={close}
                  disabled={submitting}
                >
                  {t('restart.cancel')}
                </button>
                <button
                  type="submit"
                  className="ghc-btn-danger"
                  disabled={submitting || phrase !== 'restart'}
                >
                  {submitting ? t('restart.submitting') : t('restart.submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}