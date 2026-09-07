'use client';

import { useState, type ReactElement } from 'react';
import { fetchCsrfToken } from '@/lib/csrf/client';

/**
 * Logout button.
 *
 * The CSRF token is rotated on login, and the in-page copy may be stale (the
 * dashboard is server-rendered and never received one). So we always re-fetch
 * a fresh token from GET /api/admin/auth/csrf immediately before POSTing to
 * /api/admin/auth/logout — the middleware rejects non-GET /api/admin/* without
 * a matching cookie+header pair.
 */
export function LogoutButton(): ReactElement {
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
      setError('Logout failed. Please try again.');
    } catch {
      setLoading(false);
      setError('Network error. Please try again.');
    }
  }

  return (
    <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
      {error !== null && (
        <span role="alert" style={{ color: 'red' }}>
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          void handleLogout();
        }}
        disabled={loading}
      >
        {loading ? 'Logging out...' : 'Log out'}
      </button>
    </span>
  );
}
