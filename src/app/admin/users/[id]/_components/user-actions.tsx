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
 *
 * M26.x — defensive UX: the Disable action requires a `confirm()` dialog
 * (matching the pattern of resetPassword / logoutAll) and is also
 * blocked when the target user is the currently-signed-in admin. The
 * server route enforces the same self-disable block; this component
 * just hides the button so the admin doesn't see a confusing disabled
 * state on their own row.
 */
export function UserActions({
  userId,
  currentStatus,
  isSelf = false,
}: {
  userId: string;
  currentStatus: 'active' | 'disabled';
  /** True when the target user === the currently-signed-in admin. */
  isSelf?: boolean;
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
    // Defense-in-depth: the server route blocks self-disable too, but
    // refuse here so the admin doesn't get an opaque 403 toast.
    if (status === 'disabled' && isSelf) return;
    // Always require explicit confirmation for the destructive direction.
    if (status === 'disabled' && !confirm(t('confirmDisable'))) return;
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
      {/* Hide the Disable button for the signed-in admin entirely. They
          have a separate "Logout" button in the admin top bar; if they
          need to disable their own account, an explicit CLI / SQL action
          is the right escape hatch (and documented in the runbook). */}
      {!isSelf && (
        <button
          onClick={() => void patchStatus(currentStatus === 'active' ? 'disabled' : 'active')}
          disabled={busy || !csrf}
        >
          {currentStatus === 'active' ? t('disable') : t('enable')}
        </button>
      )}
      <button onClick={() => void logoutAll()} disabled={busy || !csrf}>
        {t('logoutAll')}
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
