'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';
import { fetchCsrfToken } from '@/lib/csrf/client';

export function LimitsForm({
  apiKeyId,
  currentRateLimit,
  currentDailyQuota,
}: {
  apiKeyId: string;
  currentRateLimit: number;
  currentDailyQuota: number;
}): ReactElement {
  const t = useTranslations('admin.apiKeys.limits');
  const router = useRouter();
  const [csrf, setCsrf] = useState('');
  const [rateLimit, setRateLimit] = useState(currentRateLimit);
  const [dailyQuota, setDailyQuota] = useState(currentDailyQuota);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchCsrfToken().then(setCsrf).catch(() => undefined);
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
      setMessage(t('failedWithError', { error: err.error ?? String(res.status) }));
      return;
    }
    setMessage(t('updatedOk'));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        {t('rateLimitLabel')}{' '}
        <input
          type="number"
          min={1}
          max={10000}
          value={rateLimit}
          onChange={(e) => setRateLimit(Number(e.target.value))}
        />
      </label>
      <label>
        {t('dailyQuotaLabel')}{' '}
        <input
          type="number"
          min={1}
          max={10000000}
          value={dailyQuota}
          onChange={(e) => setDailyQuota(Number(e.target.value))}
        />
      </label>
      <button type="submit" disabled={busy || !csrf || !dirty}>
        {t('save')}
      </button>
      {message && <p>{message}</p>}
    </form>
  );
}