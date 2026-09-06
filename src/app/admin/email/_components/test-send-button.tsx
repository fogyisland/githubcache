'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

interface Props {
  csrfToken: string;
}

/**
 * M25 — "Send test email" button.
 *
 * POSTs to /api/admin/email/test. Sends to the currently-logged-in
 * admin's email (the server resolves that from the session, so the
 * client only sends CSRF). Shows a status line with the result.
 */
export function TestSendButton({ csrfToken }: Props): React.ReactElement {
  const t = useTranslations('admin.email.test');
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/email/test', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify({ csrf: csrfToken }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          messageId?: string;
          error?: string;
        };
        if (body.ok) {
          setStatus({ ok: true, message: t('ok') });
        } else if (body.error === 'not_configured') {
          setStatus({ ok: false, message: t('failedNotConfigured') });
        } else {
          setStatus({ ok: false, message: t('failedWithError', { error: body.error ?? 'unknown' }) });
        }
      } catch (err: unknown) {
        setStatus({
          ok: false,
          message: t('failedWithError', { error: err instanceof Error ? err.message : 'unknown' }),
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="ghc-admin-test-send">
      <button type="submit" disabled={pending} className="ghc-btn-primary">
        {pending ? t('submitting') : t('submit')}
      </button>
      {status ? (
        <p
          className={
            status.ok
              ? 'ghc-admin-form-status ghc-admin-form-status-ok'
              : 'ghc-admin-form-status ghc-admin-form-status-error'
          }
        >
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
