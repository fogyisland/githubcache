'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';
import { adminFetch } from '@/lib/api/admin-fetch';
import { fetchCsrfToken } from '@/lib/csrf/client';

export function AddTokenForm(): ReactElement {
  const t = useTranslations('admin.githubTokens.addForm');
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!token || !label) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const csrf = await fetchCsrfToken();
      await adminFetch('/api/admin/github-tokens', {
        method: 'POST',
        body: { label, token, csrf },
      });
      setBusy(false);
      setSuccess(t('success'));
      setLabel('');
      setToken('');
      router.refresh();
    } catch (err: unknown) {
      setBusy(false);
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        {t('labelLabel')}{' '}
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('labelPlaceholder')}
          required
        />
      </label>
      <label>
        {t('tokenLabel')}{' '}
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t('tokenPlaceholder')}
          required
          rows={3}
          className="ghc-input-mono"
        />
      </label>
      <button type="submit" disabled={busy || !token || !label}>
        {t('submit')}
      </button>
      {error && <p role="alert">{error}</p>}
      {success && <p role="status">{success}</p>}
    </form>
  );
}