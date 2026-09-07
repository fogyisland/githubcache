'use client';
import { useEffect, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { fetchCsrfToken } from '@/lib/csrf/client';

/**
 * Delete button — calls DELETE /api/admin/providers/[id] (admin-only)
 * and routes back to /admin/providers on success.
 */
export function ProviderDelete({
  providerId,
  slug,
}: {
  providerId: string;
  slug: string;
}): ReactElement {
  const router = useRouter();
  const t = useTranslations('admin.providers');
  const [csrf, setCsrf] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchCsrfToken().then(setCsrf).catch(() => undefined);
  }, []);

  async function onDelete(): Promise<void> {
    if (!csrf) return;
    if (!confirm(t('actions.confirmDelete', { slug }))) return;
    setBusy(true);
    const res = await fetch(`/api/admin/providers/${providerId}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (res.ok) router.push('/admin/providers');
  }

  return (
    <button
      type="button"
      onClick={() => void onDelete()}
      disabled={busy || !csrf}
      className="ghc-btn-danger"
    >
      {t('actions.delete')}
    </button>
  );
}