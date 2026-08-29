'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

interface CreatedResponse {
  id: string;
  url: string;
  eventFilter: string[];
  secret: string;
}

/**
 * Add a new webhook subscription. On success, displays the one-time
 * signing secret in a copyable code block with a warning that it
 * cannot be recovered after the admin navigates away.
 */
export function AddWebhookForm(): ReactElement {
  const t = useTranslations('admin.webhooks.add');
  const router = useRouter();
  const [csrf, setCsrf] = useState('');
  const [url, setUrl] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedResponse | null>(null);

  useEffect(() => {
    void fetch('/api/admin/auth/csrf')
      .then((r) => r.json())
      .then((d: { csrfToken: string }) => setCsrf(d.csrfToken));
  }, []);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!csrf) return;
    setBusy(true);
    setError(null);
    const events = filter
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const res = await fetch('/api/admin/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ url, eventFilter: events, csrf }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? String(res.status));
      return;
    }
    const data = (await res.json()) as CreatedResponse;
    setCreated(data);
    setUrl('');
    setFilter('');
    router.refresh();
  }

  if (created) {
    return (
      <div className="ghc-admin-add-webhook-secret">
        <h3 className="ghc-admin-secret-heading">{t('secret.heading')}</h3>
        <p className="ghc-admin-secret-warning">{t('secret.warning')}</p>
        <code className="ghc-admin-secret-value" data-testid="ghc-webhook-secret">
          {created.secret}
        </code>
        <button
          type="button"
          className="ghc-btn-secondary"
          onClick={() => {
            setCreated(null);
            router.refresh();
          }}
        >
          {t('secret.dismiss')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="ghc-admin-add-webhook-form">
      <label className="ghc-admin-field">
        <span>{t('url')}</span>
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('urlPlaceholder')}
          className="ghc-admin-input"
        />
      </label>
      <label className="ghc-admin-field">
        <span>{t('filter')}</span>
        <input
          type="text"
          required
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('filterPlaceholder')}
          className="ghc-admin-input"
        />
      </label>
      {error ? <p className="ghc-admin-error">{error}</p> : null}
      <button type="submit" disabled={!csrf || busy} className="ghc-btn-primary">
        {busy ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}