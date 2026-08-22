'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactElement } from 'react';

export function KeyActions({
  apiKeyId,
  currentStatus,
}: {
  apiKeyId: string;
  currentStatus: 'pending' | 'active' | 'revoked';
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

  async function callApprove(): Promise<void> {
    if (!csrf) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/api-keys/${apiKeyId}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(`Approve failed: ${err.error ?? res.status}`);
      return;
    }
    setMessage('Approved.');
    router.refresh();
  }

  async function callRevoke(): Promise<void> {
    if (!csrf) return;
    if (!confirm('Revoke this key? It will stop working immediately.')) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/api-keys/${apiKeyId}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(`Revoke failed: ${err.error ?? res.status}`);
      return;
    }
    setMessage('Revoked.');
    router.refresh();
  }

  return (
    <div>
      {currentStatus === 'pending' && (
        <button onClick={() => void callApprove()} disabled={busy || !csrf}>
          Approve
        </button>
      )}
      {currentStatus === 'active' && (
        <button onClick={() => void callRevoke()} disabled={busy || !csrf}>
          Revoke
        </button>
      )}
      {currentStatus === 'revoked' && <em>Already revoked.</em>}
      {message && <p>{message}</p>}
    </div>
  );
}