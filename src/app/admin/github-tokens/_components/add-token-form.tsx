'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

export function AddTokenForm(): ReactElement {
  const t = useTranslations('admin.githubTokens.addForm');
  const router = useRouter();
  const [csrf, setCsrf] = useState('');
  const [label, setLabel] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/admin/auth/csrf')
      .then((r) => r.json())
      .then((d: { csrfToken: string }) => setCsrf(d.csrfToken));
  }, []);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!csrf || !token || !label) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const res = await fetch('/api/admin/github-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ label, token, csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? t('error.http', { status: res.status }));
      return;
    }
    setSuccess(t('success'));
    setLabel('');
    setToken('');
    router.refresh();
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
      <button type="submit" disabled={busy || !csrf || !token || !label}>
        {t('submit')}
      </button>
      {error && <p role="alert">{error}</p>}
      {success && <p role="status">{success}</p>}
    </form>
  );
}
