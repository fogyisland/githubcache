'use client';
import { useState, useEffect, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * Client component: per-user admin actions (M13.4 i18n).
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
  const t = useTranslations('admin.users.actions');
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
      setMessage(t('failedWithStatus', { status: res.status }));
      return;
    }
    setMessage(status === 'disabled' ? t('disabledOk') : t('enabledOk'));
    router.refresh();
  }

  async function logoutAll(): Promise<void> {
    if (!csrf) return;
    if (!confirm(t('confirmLogoutAll'))) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(t('failedWithStatus', { status: res.status }));
      return;
    }
    const data = (await res.json()) as { sessionsInvalidated: number };
    setMessage(t('loggedOutCount', { count: data.sessionsInvalidated }));
    router.refresh();
  }

  async function resetPassword(): Promise<void> {
    if (!csrf) return;
    if (!confirm(t('confirmResetPassword'))) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(t('failedWithStatus', { status: res.status }));
      return;
    }
    const data = (await res.json()) as { tempPassword: string };
    setMessage(t('tempPasswordMessage', { password: data.tempPassword }));
  }

  return (
    <div>
      <button onClick={() => void resetPassword()} disabled={busy || !csrf}>
        {t('resetPassword')}
      </button>
      <button
        onClick={() => void patchStatus(currentStatus === 'active' ? 'disabled' : 'active')}
        disabled={busy || !csrf}
      >
        {currentStatus === 'active' ? t('disable') : t('enable')}
      </button>
      <button onClick={() => void logoutAll()} disabled={busy || !csrf}>
        {t('logoutAll')}
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
