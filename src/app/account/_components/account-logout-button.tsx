'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { fetchCsrfToken } from '@/lib/csrf/client';

/**
 * M26 — account-center logout button.
 *
 * Mirrors src/app/admin/logout-button.tsx but renders for the public
 * /account surface. Hits the same /api/admin/auth/csrf + /api/admin/
 * auth/logout endpoints (the session cookie is the same — the session
 * DB row is reused, only the chrome differs).
 */
export function AccountLogoutButton(): React.ReactElement {
  const t = useTranslations('account.logout');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout(): Promise<void> {
    setLoading(true);
    try {
      const csrfToken = await fetchCsrfToken();
      const res = await fetch('/api/admin/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (res.ok) {
        window.location.href = '/login';
        return;
      }
      setLoading(false);
      setError(t('error'));
    } catch {
      setLoading(false);
      setError(t('error'));
    }
  }

  return (
    <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
      {error !== null && (
        <span role="alert" className="ghc-text-danger text-sm">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          void handleLogout();
        }}
        disabled={loading}
        className="ghc-btn-secondary ghc-btn-sm"
      >
        {loading ? t('loggingOut') : t('label')}
      </button>
    </span>
  );
}
