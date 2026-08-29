'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

/** Re-queue a dead or failed delivery so the worker picks it up immediately.
 *  Admin-only. */
export function RetryDeliveryButton({
  deliveryId,
}: {
  deliveryId: string;
}): ReactElement {
  const t = useTranslations('admin.webhooks.retry');
  const router = useRouter();
  const [csrf, setCsrf] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/admin/auth/csrf')
      .then((r) => r.json())
      .then((d: { csrfToken: string }) => setCsrf(d.csrfToken));
  }, []);

  async function onRetry(): Promise<void> {
    if (!csrf) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(
      `/api/admin/webhooks/deliveries/${deliveryId}/retry`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ csrf }),
      },
    );
    setBusy(false);
    if (!res.ok) {
      setMessage(t('failed', { status: String(res.status) }));
      return;
    }
    setMessage(t('ok'));
    router.refresh();
  }

  return (
    <div className="ghc-admin-retry-cell">
      <button
        type="button"
        disabled={!csrf || busy}
        onClick={onRetry}
        className="ghc-btn-secondary"
      >
        {busy ? t('busy') : t('retry')}
      </button>
      {message ? <span className="ghc-admin-action-message">{message}</span> : null}
    </div>
  );
}