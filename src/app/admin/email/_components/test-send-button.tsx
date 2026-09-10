'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { adminFetch } from '@/lib/api/admin-fetch';

interface Props {
  csrfToken: string;
}

/**
 * M25 — "Send test email" button.
 *
 * POSTs to /api/admin/email/test. Sends to the currently-logged-in
 * admin's email (the server resolves that from the session). adminFetch
 * auto-injects the x-csrf-token header; the prop is still required because
 * the route handler validates `body.csrf` (double-submit cookie check).
 */
export function TestSendButton({ csrfToken }: Props): React.ReactElement {
  const t = useTranslations('admin.email.test');
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    startTransition(async () => {
      try {
        const body = await adminFetch<{
          ok?: boolean;
          messageId?: string;
          error?: string;
        }>('/api/admin/email/test', {
          method: 'POST',
          body: { csrf: csrfToken },
        });
        if (body.ok) {
          setStatus({ ok: true, message: t('ok') });
        } else if (body.error === 'not_configured') {
          setStatus({ ok: false, message: t('failedNotConfigured') });
        } else {
          setStatus({ ok: false, message: t('failedWithError', { error: body.error ?? 'unknown' }) });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown';
        setStatus({
          ok: false,
          message: t('failedWithError', { error: message }),
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