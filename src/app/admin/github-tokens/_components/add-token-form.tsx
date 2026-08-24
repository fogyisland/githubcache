'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactElement } from 'react';

export function AddTokenForm(): ReactElement {
  const router = useRouter();
  const [csrf, setCsrf] = useState('');
  const [label, setLabel] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/admin/auth/csrf')
      .then((r) => r.json())
      .then((d: { csrfToken: string }) => setCsrf(d.csrfToken));
  }, []);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!csrf || !token || !label) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const res = await fetch('/api/admin/github-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ label, token, csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `HTTP ${res.status}`);
      return;
    }
    setSuccess(
      'Token registered. Activate by adding to GITHUB_TOKENS env / file and restarting.',
    );
    setLabel('');
    setToken('');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        Label:{' '}
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. user-ci-token"
          required
        />
      </label>
      <label>
        Token (plaintext, will NOT be stored):{' '}
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_..."
          required
          rows={3}
          style={{ width: '100%', maxWidth: '500px', fontFamily: 'monospace' }}
        />
      </label>
      <button type="submit" disabled={busy || !csrf || !token || !label}>
        Register token
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {success && <p style={{ color: 'green' }}>{success}</p>}
    </form>
  );
}
