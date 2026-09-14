'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';
import { adminFetch } from '@/lib/api/admin-fetch';
import { fetchCsrfToken } from '@/lib/csrf/client';

/**
 * M32.5 — Add a GitHub token form. Renders inline within an
 * AdminTable section, styled with the shared ghc-* form tokens
 * (was previously terminal-frame keycaps).
 */
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
    <form onSubmit={onSubmit} className="ghc-admin-form" noValidate>
      <label className="ghc-admin-field">
        <span className="ghc-admin-field-label">{t('labelLabel')}</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('labelPlaceholder')}
          required
          className="ghc-input"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="ghc-admin-field">
        <span className="ghc-admin-field-label">{t('tokenLabel')}</span>
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t('tokenPlaceholder')}
          required
          rows={3}
          className="ghc-input ghc-input-mono"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="ghc-admin-form-actions">
        <button
          type="submit"
          className="ghc-btn-primary"
          disabled={busy || !token || !label}
          aria-busy={busy}
        >
          {busy ? '…' : t('submit')}
        </button>
        {success ? (
          <span className="ghc-admin-form-msg" role="status">
            {success}
          </span>
        ) : null}
        {error ? (
          <span className="ghc-admin-form-msg ghc-text-danger" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}