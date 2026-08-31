'use client';
import { useEffect, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * Toggle button — flips the provider's enabled flag via
 * POST /api/admin/providers/[id]/toggle (admin-only).
 */
export function ProviderToggle({
  providerId,
  enabled,
}: {
  providerId: string;
  enabled: boolean;
}): ReactElement {
  const router = useRouter();
  const t = useTranslations('admin.providers');
  const [csrf, setCsrf] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch('/api/admin/auth/csrf')
      .then((r) => r.json())
      .then((d: { csrfToken: string }) => setCsrf(d.csrfToken));
  }, []);

  async function onToggle(): Promise<void> {
    if (!csrf) return;
    setBusy(true);
    const res = await fetch(`/api/admin/providers/${providerId}/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void onToggle()}
      disabled={busy || !csrf}
      className="ghc-btn-secondary"
    >
      {enabled ? t('actions.disable') : t('actions.enable')}
    </button>
  );
}