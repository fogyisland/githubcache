'use client';
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { adminFetch } from '@/lib/api/admin-fetch';
import { fetchCsrfToken } from '@/lib/csrf/client';

interface ProviderRow {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
}

interface PreviewTotals {
  items: number;
  urls: number;
  unique: number;
  invalid: number;
  existing: number;
  stale: number;
  new: number;
}

interface PreviewResponse {
  totals: PreviewTotals;
  sample: { owner: string; name: string }[];
  poolEmpty?: boolean;
}

/**
 * M31 — Preview via provider (client island).
 *
 * Per the user directive ("不支持批量提交，批量提交也就是一个一个的提交"),
 * providers may preview their unique owner/name pairs (read-only) but
 * CANNOT execute batch insertion. Each owner/name must be queued
 * individually via the public lookup API.
 *
 * Loads the configured provider list, lets the operator pick one, and
 * exposes a Preview button (parse + dedupe + classify against the DB).
 * The preview response surfaces an inline sample so operators can see
 * which owner/name pairs are stale or new.
 */
export function RunViaProvider(): ReactElement {
  const t = useTranslations('admin.providers.runCard');
  const tPreview = useTranslations('admin.providers.previewResult');

  const [providers, setProviders] = useState<ProviderRow[] | null>(null);
  const [loadError, setLoadError] = useState<{ status: number } | null>(null);
  const [csrfReady, setCsrfReady] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [limit, setLimit] = useState('');

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<{ status: number } | null>(null);

  useEffect(() => {
    void Promise.all([
      fetch('/api/admin/providers?enabled=true').then((r) => r.json() as Promise<{ providers: ProviderRow[] }>),
      fetchCsrfToken(),
    ])
      .then(([prov]) => {
        setProviders(prov.providers);
        setCsrfReady(true);
      })
      .catch(() => setLoadError({ status: 0 }));
  }, []);

  async function onPreview(): Promise<void> {
    if (!csrfReady || !selectedId) return;
    setPreviewBusy(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const csrf = await fetchCsrfToken();
      const body: Record<string, unknown> = { csrf };
      if (limit.trim() !== '') body.limit = Number(limit);
      const data = await adminFetch<PreviewResponse>(
        `/api/admin/providers/${selectedId}/preview`,
        {
          method: 'POST',
          body,
        },
      );
      setPreview(data);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const status = message.startsWith('adminFetch ')
        ? Number(message.split(' ')[1]?.split(':')[0] ?? 0)
        : 0;
      setPreviewError({ status });
    } finally {
      setPreviewBusy(false);
    }
  }

  if (loadError) {
    return (
      <section className="ghc-admin-card" aria-label="Run via provider">
        <p className="ghc-admin-error">{t('createFailed', { status: loadError.status })}</p>
      </section>
    );
  }

  if (providers === null) {
    return (
      <section className="ghc-admin-card" aria-label="Run via provider">
        <p className="ghc-admin-card-empty">…</p>
      </section>
    );
  }

  if (providers.length === 0) {
    return (
      <section className="ghc-admin-card" aria-label="Run via provider">
        <h2 className="ghc-admin-card-title">{t('heading')}</h2>
        <p className="ghc-admin-card-desc">{t('description')}</p>
        <p className="ghc-admin-empty-inline">{t('noProviders')}</p>
      </section>
    );
  }

  return (
    <section className="ghc-admin-card" aria-label="Run via provider">
      <h2 className="ghc-admin-card-title">{t('heading')}</h2>
      <p className="ghc-admin-card-desc">{t('description')}</p>

      <div className="ghc-admin-run-row">
        <label className="ghc-admin-field">
          <span>{t('chooseProvider')}</span>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="ghc-api-settings-input"
          >
            <option value="">—</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.slug})
              </option>
            ))}
          </select>
        </label>

        <label className="ghc-admin-field">
          <span>{t('limitLabel')}</span>
          <input
            type="number"
            min="1"
            max="10000"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="ghc-api-settings-input"
          />
        </label>
      </div>

      <div className="ghc-admin-form-actions">
        <button
          type="button"
          onClick={() => void onPreview()}
          disabled={previewBusy || !csrfReady || !selectedId}
          className="ghc-btn-secondary"
        >
          {t('submitPreview')}
        </button>
      </div>

      {previewError ? (
        <p className="ghc-admin-error">{t('previewFailed', { status: previewError.status })}</p>
      ) : null}

      {preview ? (
        <section className="ghc-admin-card-inner">
          <h3 className="ghc-admin-card-title">{t('submitPreview')}</h3>
          <dl className="ghc-admin-totals">
            <div>
              <dt>{tPreview('items')}</dt>
              <dd>{preview.totals.items}</dd>
            </div>
            <div>
              <dt>{tPreview('urls')}</dt>
              <dd>{preview.totals.urls}</dd>
            </div>
            <div>
              <dt>{tPreview('unique')}</dt>
              <dd>{preview.totals.unique}</dd>
            </div>
            <div>
              <dt>{tPreview('existing')}</dt>
              <dd>{preview.totals.existing}</dd>
            </div>
            <div>
              <dt>{tPreview('stale')}</dt>
              <dd>{preview.totals.stale}</dd>
            </div>
            <div>
              <dt>{tPreview('new')}</dt>
              <dd>{preview.totals.new}</dd>
            </div>
            <div>
              <dt>{tPreview('invalid')}</dt>
              <dd>{preview.totals.invalid}</dd>
            </div>
          </dl>
          {preview.sample.length > 0 ? (
            <ul className="ghc-admin-sample">
              {preview.sample.map((s) => (
                <li key={`${s.owner}/${s.name}`}>
                  <code>
                    {s.owner}/{s.name}
                  </code>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
