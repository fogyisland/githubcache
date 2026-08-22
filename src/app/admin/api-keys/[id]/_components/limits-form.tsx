'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactElement } from 'react';

export function LimitsForm({
  apiKeyId,
  currentRateLimit,
  currentDailyQuota,
}: {
  apiKeyId: string;
  currentRateLimit: number;
  currentDailyQuota: number;
}): ReactElement {
  const router = useRouter();
  const [csrf, setCsrf] = useState('');
  const [rateLimit, setRateLimit] = useState(currentRateLimit);
  const [dailyQuota, setDailyQuota] = useState(currentDailyQuota);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/admin/auth/csrf')
      .then((r) => r.json())
      .then((d: { csrfToken: string }) => setCsrf(d.csrfToken));
  }, []);

  const dirty = rateLimit !== currentRateLimit || dailyQuota !== currentDailyQuota;

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!csrf || !dirty) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/admin/api-keys/${apiKeyId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({
        rateLimitPerMin: rateLimit,
        dailyQuota,
        csrf,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(`Failed: ${err.error ?? res.status}`);
      return;
    }
    setMessage('Limits updated.');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        Rate limit per min:{' '}
        <input
          type="number"
          min={1}
          max={10000}
          value={rateLimit}
          onChange={(e) => setRateLimit(Number(e.target.value))}
        />
      </label>
      <label>
        Daily quota:{' '}
        <input
          type="number"
          min={1}
          max={10000000}
          value={dailyQuota}
          onChange={(e) => setDailyQuota(Number(e.target.value))}
        />
      </label>
      <button type="submit" disabled={busy || !csrf || !dirty}>
        Save limits
      </button>
      {message && <p>{message}</p>}
    </form>
  );
}