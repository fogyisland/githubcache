'use client';
import { useState, useEffect, type ReactElement, type FormEvent as ReactFormEvent } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Client component: invite a new user (M13.4 i18n).
 *
 * Fetches CSRF on mount, posts to /api/admin/users/invite, displays the
 * returned invitation link. The actual invite UX (consuming the link,
 * choosing a password) lives at /request-access and is M7-deferred.
 */
export function InviteForm(): ReactElement {
  const t = useTranslations('admin.users.invite');
  const [csrf, setCsrf] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'operator'>('operator');
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/admin/auth/csrf')
      .then((r) => r.json())
      .then((d: { csrfToken: string }) => setCsrf(d.csrfToken));
  }, []);

  async function onSubmit(e: ReactFormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setInviteLink(null);
    const res = await fetch('/api/admin/users/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ email, role, csrf }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? t('error.http', { status: res.status }));
      return;
    }
    const data = (await res.json()) as { inviteLink: string };
    setInviteLink(data.inviteLink);
    setEmail('');
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
