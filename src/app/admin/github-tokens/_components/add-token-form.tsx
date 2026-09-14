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
    <form onSubmit={onSubmit} className="ghc-term-form" noValidate>
      <label className="ghc-term-field">
        <span className="ghc-term-field-label">
          <span className="ghc-term-prompt">&gt;</span>
          LABEL
        </span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('labelPlaceholder')}
          required
          className="ghc-term-input"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="ghc-term-field">
        <span className="ghc-term-field-label">
          <span className="ghc-term-prompt">&gt;</span>
          TOKEN
        </span>
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t('tokenPlaceholder')}
          required
          rows={3}
          className="ghc-term-input"
          autoComplete="off"
          spellCheck={false}
        />
        <span className="ghc-term-field-hint ghc-term-dim">
          {t('tokenLabel')}
        </span>
      </label>
      <div className="ghc-term-form-actions">
        <button
          type="submit"
          className="ghc-term-keycap"
          data-variant="ok"
          disabled={busy || !token || !label}
        >
          [ {busy ? '…' : t('submit')} ]
        </button>
        {success ? (
          <span className="ghc-term-form-msg ghc-term-ok" role="status">
            <span className="ghc-term-prompt">&gt;</span>ok {success}
          </span>
        ) : null}
        {error ? (
          <span className="ghc-term-form-msg ghc-term-err" role="alert">
            <span className="ghc-term-prompt">!</span>err {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
