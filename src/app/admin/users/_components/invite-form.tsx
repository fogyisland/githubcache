'use client';
import { useState, useEffect, type ReactElement, type FormEvent as ReactFormEvent } from 'react';

/**
 * Client component: invite a new user.
 *
 * Fetches CSRF on mount, posts to /api/admin/users/invite, displays the
 * returned invitation link. The actual invite UX (consuming the link,
 * choosing a password) lives at /request-access and is M7-deferred.
 */
export function InviteForm(): ReactElement {
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
      setError(err.error ?? `HTTP ${res.status}`);
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
        placeholder="email@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'operator')}>
        <option value="operator">Operator</option>
        <option value="admin">Admin</option>
      </select>
      <button type="submit">Send invitation</button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {inviteLink && (
        <p>
          Invitation link: <code>{inviteLink}</code>
        </p>
      )}
    </form>
  );
}
