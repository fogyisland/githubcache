'use client';

import { useState, type ReactElement } from 'react';
import { adminFetch } from '@/lib/api/admin-fetch';

/**
 * Logout button.
 *
 * adminFetch handles CSRF + credentials. On success we navigate to /login.
 */
export function LogoutButton(): ReactElement {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout(): Promise<void> {
    setLoading(true);
    try {
      await adminFetch('/api/admin/auth/logout', {
        method: 'POST',
      });
      window.location.href = '/login';
      return;
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