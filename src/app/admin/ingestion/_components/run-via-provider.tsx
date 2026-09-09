'use client';
import { useEffect, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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

interface RunResponse {
  totals: PreviewTotals;
  jobCount: number;
  poolEmpty?: boolean;
}

/**
 * M19.10 — Run via provider (client island).
 *
 * Loads the configured provider list, lets the operator pick one, and
 * exposes Preview (parse + dedupe + classify) and Run (enqueue refresh
 * jobs) buttons. After Run, refreshes the page so the RecentJobsTable
 * picks up the newly-enqueued jobs.
 *
 * Pool-empty state is read from the run/preview response; we show a
 * warning banner whenever poolEmpty comes back true so operators know
 * jobs will fail at fetch time.
 */
export function RunViaProvider(): ReactElement {
  const t = useTranslations('admin.providers.runCard');
  const tPreview = useTranslations('admin.providers.previewResult');
  const router = useRouter();

  const [providers, setProviders] = useState<ProviderRow[] | null>(null);
  const [loadError, setLoadError] = useState<{ status: number } | null>(null);
  const [csrf, setCsrf] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [limit, setLimit] = useState('');
  const [dryRun, setDryRun] = useState(true);

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<{ status: number } | null>(null);

  const [runResult, setRunResult] = useState<RunResponse | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<{ status: number } | null>(null);

  useEffect(() => {
    void Promise.all([
      fetch('/api/admin/providers?enabled=true').then((r) => r.json() as Promise<{ providers: ProviderRow[] }>),
      fetchCsrfToken(),
    ])
      .then(([prov, csrfToken]) => {
        setProviders(prov.providers);
        setCsrf(csrfToken);
      })
      .catch(() => setLoadError({ status: 0 }));
  }, []);

  async function onPreview(): Promise<void> {
    if (!csrf || !selectedId) return;
    setPreviewBusy(true);
    setPreviewError(null);
    setPreview(null);
    const body: Record<string, unknown> = { csrf };
    if (limit.trim() !== '') body.limit = Number(limit);
    const res = await fetch(`/api/admin/providers/${selectedId}/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(body),
    });
    setPreviewBusy(false);
    if (!res.ok) {
      setPreviewError({ status: res.status });
      return;
    }
    const data = (await res.json()) as PreviewResponse;
    setPreview(data);
  }

  async function onRun(): Promise<void> {
    if (!csrf || !selectedId) return;
    setRunBusy(true);
    setRunError(null);
    setRunResult(null);
    const body: Record<string, unknown> = { dryRun, csrf };
    if (limit.trim() !== '') body.limit = Number(limit);
    const res = await fetch(`/api/admin/providers/${selectedId}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(body),
    });
    setRunBusy(false);
    if (!res.ok) {
      setRunError({ status: res.status });
      return;
    }
    const data = (await res.json()) as RunResponse;
    setRunResult(data);
    if (!dryRun && data.jobCount > 0) {
      router.refresh();
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

  const showPoolEmpty = (preview?.poolEmpty ?? runResult?.poolEmpty ?? false) && !dryRun;

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

        <label className="ghc-admin-checkbox">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          {t('dryRun')}
        </label>
      </div>

      <div className="ghc-admin-form-actions">
        <button
          type="button"
          onClick={() => void onPreview()}
          disabled={previewBusy || !csrf || !selectedId}
          className="ghc-btn-secondary"
        >
          {t('submitPreview')}
        </button>
        <button
          type="button"
          onClick={() => void onRun()}
          disabled={runBusy || !csrf || !selectedId}
          className="ghc-btn-primary"
        >
          {t('submitRun')}
        </button>
      </div>

      {showPoolEmpty ? (
        <p className="ghc-admin-warning">{t('poolEmptyWarning')}</p>
      ) : null}

      {previewError ? (
        <p className="ghc-admin-error">{t('previewFailed', { status: previewError.status })}</p>
      ) : null}
      {runError ? (
        <p className="ghc-admin-error">{t('runFailed', { status: runError.status })}</p>
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

      {runResult ? (
        <p className="ghc-admin-success">
          {t('runOk', { jobCount: runResult.jobCount })}
        </p>
      ) : null}
    </section>
  );
}