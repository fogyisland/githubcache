'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';
import { adminFetch } from '@/lib/api/admin-fetch';

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
 *
 * CSRF: adminFetch injects the x-csrf-token header. The route does not
 * validate body.csrf (middleware checks header only).
 */
export function AddWebhookForm(): ReactElement {
  const t = useTranslations('admin.webhooks.add');
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedResponse | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const events = filter
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    try {
      const data = await adminFetch<CreatedResponse>('/api/admin/webhooks', {
        method: 'POST',
        body: { url, eventFilter: events },
      });
      setCreated(data);
      setUrl('');
      setFilter('');
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setBusy(false);
    }
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
          className="ghc-api-settings-input"
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
          className="ghc-api-settings-input"
        />
      </label>
      {error ? <p className="ghc-admin-error">{error}</p> : null}
      <button type="submit" disabled={busy} className="ghc-btn-primary">
        {busy ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}