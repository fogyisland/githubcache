'use client';
import { useState, type ReactElement, type FormEvent as ReactFormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { adminFetch } from '@/lib/api/admin-fetch';
import { fetchCsrfToken } from '@/lib/csrf/client';

/**
 * Client component: invite a new user (M13.4 i18n).
 *
 * Calls adminFetch to POST /api/admin/users/invite, displays the
 * returned invitation link. The actual invite UX (consuming the link,
 * choosing a password) lives at /request-access and is M7-deferred.
 */
export function InviteForm(): ReactElement {
  const t = useTranslations('admin.users.invite');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'operator'>('operator');
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  async function onSubmit(e: ReactFormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setInviteLink(null);
    try {
      const csrf = await fetchCsrfToken();
      const data = await adminFetch<{ inviteLink: string }>(
        '/api/admin/users/invite',
        {
          method: 'POST',
          body: { email, role, csrf },
        },
      );
      setInviteLink(data.inviteLink);
      setEmail('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <input
        type="email"
        placeholder={t('emailPlaceholder')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'operator')}>
        <option value="operator">{t('role.operator')}</option>
        <option value="admin">{t('role.admin')}</option>
      </select>
      <button type="submit">{t('submit')}</button>
      {error && <p role="alert">{error}</p>}
      {inviteLink && (
        <p>
          {t('linkLabel')}: <code>{inviteLink}</code>
        </p>
      )}
    </form>
  );
}