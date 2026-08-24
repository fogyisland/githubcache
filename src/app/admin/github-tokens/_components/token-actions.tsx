'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { GithubTokenStatus } from '@prisma/client';
import type { ReactElement } from 'react';

export function TokenActions({
  tokenId,
  currentStatus,
}: {
  tokenId: string;
  currentStatus: GithubTokenStatus;
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

  async function patchStatus(status: GithubTokenStatus): Promise<void> {
    if (!csrf) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/github-tokens/${tokenId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ status, csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(`Failed: ${err.error ?? res.status}`);
      return;
    }
    setMessage(
      status === 'disabled'
        ? 'Token disabled (takes effect on next service restart).'
        : 'Token enabled.',
    );
    router.refresh();
  }

  async function deleteToken(): Promise<void> {
    if (!csrf) return;
    if (
      !confirm(
        'Delete this token from the DB registry? If it is still in GITHUB_TOKENS env/file, it will re-appear on next restart.',
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/github-tokens/${tokenId}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(`Failed: ${err.error ?? res.status}`);
      return;
    }
    setMessage('Token deleted from DB registry.');
    router.refresh();
  }

  return (
    <div>
      <button
        onClick={() => void patchStatus(currentStatus === 'active' ? 'disabled' : 'active')}
        disabled={busy || !csrf}
      >
        {currentStatus === 'active' ? 'Disable' : 'Enable'}
      </button>
      <button onClick={() => void deleteToken()} disabled={busy || !csrf}>
        Delete
      </button>
      {message && <p>{message}</p>}
    </div>
  );
}
