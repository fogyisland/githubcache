'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

/** Per-row actions on the webhooks list page. Disable / re-arm / rotate
 *  secret. Rotation surfaces the new secret inline like creation. */
export function WebhookActions({
  subscriptionId,
  currentActive,
}: {
  subscriptionId: string;
  currentActive: boolean;
}): ReactElement {
  const t = useTranslations('admin.webhooks.actions');
  const router = useRouter();
  const [csrf, setCsrf] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/admin/auth/csrf')
      .then((r) => r.json())
      .then((d: { csrfToken: string }) => setCsrf(d.csrfToken));
  }, []);

  async function callDisable(): Promise<void> {
    if (!csrf) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/webhooks/${subscriptionId}/disable`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(t('disableFailed', { status: String(res.status) }));
      return;
    }
    setMessage(t('disabledOk'));
    router.refresh();
  }

  async function callReArm(): Promise<void> {
    if (!csrf) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/webhooks/${subscriptionId}/re-arm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(t('reArmFailed', { status: String(res.status) }));
      return;
    }
    setMessage(t('reArmedOk'));
    router.refresh();
  }

  async function callRotate(): Promise<void> {
    if (!csrf) return;
    if (!confirm(t('confirmRotate'))) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/webhooks/${subscriptionId}/rotate-secret`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(t('rotateFailed', { status: String(res.status) }));
      return;
    }
    const data = (await res.json()) as { secret: string };
    setRotatedSecret(data.secret);
    router.refresh();
  }

  if (rotatedSecret) {
    return (
      <div className="ghc-admin-rotated-secret">
        <code className="ghc-admin-secret-value" data-testid="ghc-webhook-secret">
          {rotatedSecret}
        </code>
        <button
          type="button"
          className="ghc-btn-secondary"
          onClick={() => setRotatedSecret(null)}
        >
          {t('dismiss')}
        </button>
      </div>
    );
  }

  return (
    <div className="ghc-admin-actions-cell">
      <div className="ghc-admin-actions-buttons">
        {currentActive ? (
          <button
            type="button"
            disabled={!csrf || busy}
            onClick={callDisable}
            className="ghc-btn-secondary"
          >
            {t('disable')}
          </button>
        ) : (
          <button
            type="button"
            disabled={!csrf || busy}
            onClick={callReArm}
            className="ghc-btn-secondary"
          >
            {t('reArm')}
          </button>
        )}
        <button
          type="button"
          disabled={!csrf || busy}
          onClick={callRotate}
          className="ghc-btn-secondary"
        >
          {t('rotate')}
        </button>
      </div>
      {message ? <p className="ghc-admin-action-message">{message}</p> : null}
    </div>
  );
}