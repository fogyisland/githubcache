'use client';
import { useState, useEffect, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { fetchCsrfToken } from '@/lib/csrf/client';

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
 *
 * M28.bug4d — typed-confirm for the Disable action. The native
 * `confirm()` dialog was too easy to mis-click; on 2026-09-07 three
 * admin accounts ended up disabled with no audit trail, and we want a
 * stronger friction step for any state-flipping action. The pattern
 * mirrors the typed-confirm used in /admin/database (RESTORE). For
 * Disable, the admin must type the literal string "DISABLE" into a
 * text field before the submit button enables. Enable direction stays
 * a single click — re-enabling a user is reversible, disabling is not.
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
  // M28.bug4d — typed-confirm input for the Disable action. Resets to
  // empty whenever the user navigates to a different target row, so a
  // leftover "DISABLE" from a previous disable isn't accidentally armed.
  const [disableConfirm, setDisableConfirm] = useState('');

  useEffect(() => {
    void fetchCsrfToken().then(setCsrf).catch(() => undefined);
  }, []);

  async function patchStatus(status: 'active' | 'disabled'): Promise<void> {
    if (!csrf) return;
    // Defense-in-depth: the server route blocks self-disable too, but
    // refuse here so the admin doesn't get an opaque 403 toast.
    if (status === 'disabled' && isSelf) return;
    // M28.bug4d — typed-confirm replaces the native confirm() dialog.
    // The submit button is disabled until the input matches exactly;
    // this check is belt-and-braces in case the button is somehow
    // clicked programmatically.
    if (status === 'disabled' && disableConfirm.trim().toUpperCase() !== 'DISABLE') return;
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
    setDisableConfirm('');
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

  // M28.bug4d — typed-confirm guard for the Disable button. Enable
  // direction stays a one-click action (re-enabling a disabled user
  // is reversible; disabling is not).
  const disableReady =
    currentStatus === 'active' &&
    !isSelf &&
    !busy &&
    csrf !== '' &&
    disableConfirm.trim().toUpperCase() === 'DISABLE';

  return (
    <div>
      <button onClick={() => void resetPassword()} disabled={busy || !csrf}>
        {t('resetPassword')}
      </button>
      {/* Hide the Disable button for the signed-in admin entirely. They
          have a separate "Logout" button in the admin top bar; if they
          need to disable their own account, an explicit CLI / SQL action
          is the right escape hatch (and documented in the runbook). */}
      {!isSelf && currentStatus === 'active' && (
        <div className="ghc-admin-form-row">
          <label className="ghc-admin-label" htmlFor="disable-confirm">
            {t('disableConfirmPrompt')}
          </label>
          <div className="ghc-admin-actions-row">
            <input
              id="disable-confirm"
              type="text"
              className="ghc-admin-input ghc-admin-input-mono"
              placeholder={t('disableConfirmPlaceholder')}
              value={disableConfirm}
              onChange={(e) => setDisableConfirm(e.target.value.toUpperCase())}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => void patchStatus('disabled')}
              disabled={!disableReady}
              className="ghc-btn ghc-btn-danger"
            >
              {busy ? t('disableSubmitting') : t('disable')}
            </button>
          </div>
        </div>
      )}
      {!isSelf && currentStatus === 'disabled' && (
        <button onClick={() => void patchStatus('active')} disabled={busy || !csrf}>
          {t('enable')}
        </button>
      )}
      <button onClick={() => void logoutAll()} disabled={busy || !csrf}>
        {t('logoutAll')}
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
