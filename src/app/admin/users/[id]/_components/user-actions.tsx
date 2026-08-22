'use client';
import { useState, useEffect, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Client component: per-user admin actions.
 *
 * Three buttons:
 *   - Reset password (POST /api/admin/users/[id]/reset-password)
 *   - Disable / Enable (PATCH /api/admin/users/[id])
 *   - Logout all sessions (DELETE /api/admin/users/[id])
 *
 * `currentStatus` decides whether the button reads "Disable" or "Enable".
 */
export function UserActions({
  userId,
  currentStatus,
}: {
  userId: string;
  currentStatus: 'active' | 'disabled';
}): ReactElement {
  const router = useRouter();
  const [csrf, setCsrf] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/admin/auth/csrf')
      .then((r) => r.json())
      .then((d: { csrfToken: string }) => setCsrf(d.csrfToken));
  }, []);

  async function patchStatus(status: 'active' | 'disabled'): Promise<void> {
    if (!csrf) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ status, csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(`Failed: ${res.status}`);
      return;
    }
    setMessage(status === 'disabled' ? 'User disabled' : 'User enabled');
    router.refresh();
  }

  async function logoutAll(): Promise<void> {
    if (!csrf) return;
    if (!confirm('Log out all sessions for this user?')) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(`Failed: ${res.status}`);
      return;
    }
    const data = (await res.json()) as { sessionsInvalidated: number };
    setMessage(`Logged out ${data.sessionsInvalidated} sessions`);
    router.refresh();
  }

  async function resetPassword(): Promise<void> {
    if (!csrf) return;
    if (!confirm('Reset password? All sessions will be invalidated.')) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(`Failed: ${res.status}`);
      return;
    }
    const data = (await res.json()) as { tempPassword: string };
    setMessage(`Temp password (copy now, won't be shown again): ${data.tempPassword}`);
  }

  return (
    <div>
      <button onClick={() => void resetPassword()} disabled={busy || !csrf}>
        Reset password
      </button>
      <button
        onClick={() => void patchStatus(currentStatus === 'active' ? 'disabled' : 'active')}
        disabled={busy || !csrf}
      >
        {currentStatus === 'active' ? 'Disable' : 'Enable'}
      </button>
      <button onClick={() => void logoutAll()} disabled={busy || !csrf}>
        Logout all sessions
      </button>
      {message && <p>{message}</p>}
    </div>
  );
}
