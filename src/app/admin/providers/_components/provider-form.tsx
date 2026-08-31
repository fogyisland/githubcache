'use client';
import { useEffect, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

interface FormState {
  slug: string;
  name: string;
  kind: 'file' | 'http';
  path: string;
  url: string;
  itemsPath: string;
  urlField: string;
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

interface PreviewResult {
  totals: PreviewTotals;
  sample: { owner: string; name: string }[];
}

interface ProviderFormProps {
  mode: 'create' | 'edit';
  initial?: Partial<FormState> & { id?: string; enabled?: boolean };
  onDelete?: () => Promise<void>;
}

/**
 * Shared client form for create + edit. Calls POST /api/admin/providers
 * on create, PATCH /api/admin/providers/[id] on edit. Toggle and
 * delete (admin-only) are exposed only on edit mode.
 *
 * Test Parse is edit-only — it needs a saved provider id to call
 * /api/admin/providers/[id]/preview. Create-mode users see a hint that
 * preview will be available after saving.
 */
export function ProviderForm({
  mode,
  initial,
  onDelete,
}: ProviderFormProps): ReactElement {
  const t = useTranslations('admin.providers');
  const tPreview = useTranslations('admin.providers.previewResult');
  const router = useRouter();

  const [csrf, setCsrf] = useState('');
  const [state, setState] = useState<FormState>({
    slug: initial?.slug ?? '',
    name: initial?.name ?? '',
    kind: initial?.kind ?? 'file',
    path: initial?.path ?? '',
    url: initial?.url ?? '',
    itemsPath: initial?.itemsPath ?? '$.custom_nodes',
    urlField: initial?.urlField ?? 'files[0]',
    enabled: initial?.enabled ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/admin/auth/csrf')
      .then((r) => r.json())
      .then((d: { csrfToken: string }) => setCsrf(d.csrfToken));
  }, []);

  const isEdit = mode === 'edit' && initial?.id !== undefined;

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!csrf) return;
    setBusy(true);
    setError(null);
    const config =
      state.kind === 'file'
        ? { kind: 'file' as const, path: state.path, itemsPath: state.itemsPath, urlField: state.urlField }
        : { kind: 'http' as const, url: state.url, itemsPath: state.itemsPath, urlField: state.urlField };

    const body =
      mode === 'create'
        ? { slug: state.slug, name: state.name, config, enabled: state.enabled, csrf }
        : { name: state.name, config, enabled: state.enabled, csrf };

    const url = mode === 'create' ? '/api/admin/providers' : `/api/admin/providers/${initial!.id}`;
    const method = mode === 'create' ? 'POST' : 'PATCH';
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? String(res.status));
      return;
    }
    if (mode === 'create') {
      router.push('/admin/providers');
    } else {
      router.refresh();
    }
  }

  async function onPreview(): Promise<void> {
    if (!csrf || !isEdit || !initial?.id) return;
    setPreviewBusy(true);
    setPreviewError(null);
    setPreview(null);
    const res = await fetch(`/api/admin/providers/${initial.id}/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ csrf }),
    });
    setPreviewBusy(false);
    if (!res.ok) {
      setPreviewError(t('runCard.previewFailed', { status: res.status }));
      return;
    }
    const data = (await res.json()) as PreviewResult;
    setPreview(data);
  }

  return (
    <form onSubmit={onSubmit} className="ghc-admin-form">
      <h2 className="ghc-admin-section-title">
        {mode === 'create' ? t('form.createHeading') : t('form.editHeading')}
      </h2>

      <label className="ghc-admin-field">
        <span>{t('field.slug')}</span>
        <input
          type="text"
          required
          value={state.slug}
          onChange={(e) => setState((s) => ({ ...s, slug: e.target.value }))}
          disabled={isEdit}
          pattern="[a-z0-9\-]+"
          className="ghc-admin-input"
        />
        <small className="ghc-admin-help">{t('form.slugHelp')}</small>
      </label>

      <label className="ghc-admin-field">
        <span>{t('field.name')}</span>
        <input
          type="text"
          required
          value={state.name}
          onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
          placeholder={t('form.namePlaceholder')}
          className="ghc-admin-input"
        />
      </label>

      <div className="ghc-admin-field">
        <span>{t('sourceType.label')}</span>
        <div className="ghc-admin-radio-row">
          <label>
            <input
              type="radio"
              name="kind"
              value="file"
              checked={state.kind === 'file'}
              onChange={() => setState((s) => ({ ...s, kind: 'file' }))}
            />
            {t('form.fileHeading')}
          </label>
          <label>
            <input
              type="radio"
              name="kind"
              value="http"
              checked={state.kind === 'http'}
              onChange={() => setState((s) => ({ ...s, kind: 'http' }))}
            />
            {t('form.httpHeading')}
          </label>
        </div>
      </div>

      {state.kind === 'file' ? (
        <label className="ghc-admin-field">
          <span>{t('form.filePathLabel')}</span>
          <input
            type="text"
            required
            value={state.path}
            onChange={(e) => setState((s) => ({ ...s, path: e.target.value }))}
            placeholder={t('form.filePathPlaceholder')}
            className="ghc-admin-input"
          />
        </label>
      ) : (
        <label className="ghc-admin-field">
          <span>{t('form.urlLabel')}</span>
          <input
            type="url"
            required
            value={state.url}
            onChange={(e) => setState((s) => ({ ...s, url: e.target.value }))}
            placeholder={t('form.urlPlaceholder')}
            className="ghc-admin-input"
          />
        </label>
      )}

      <label className="ghc-admin-field">
        <span>{t('form.itemsPathLabel')}</span>
        <input
          type="text"
          required
          value={state.itemsPath}
          onChange={(e) => setState((s) => ({ ...s, itemsPath: e.target.value }))}
          placeholder={t('form.itemsPathPlaceholder')}
          className="ghc-admin-input"
        />
        <small className="ghc-admin-help">{t('form.itemsPathHelp')}</small>
      </label>

      <label className="ghc-admin-field">
        <span>{t('form.urlFieldLabel')}</span>
        <input
          type="text"
          required
          value={state.urlField}
          onChange={(e) => setState((s) => ({ ...s, urlField: e.target.value }))}
          placeholder={t('form.urlFieldPlaceholder')}
          className="ghc-admin-input"
        />
        <small className="ghc-admin-help">{t('form.urlFieldHelp')}</small>
      </label>

      <label className="ghc-admin-checkbox">
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={(e) => setState((s) => ({ ...s, enabled: e.target.checked }))}
        />
        {t('field.enabled')}
      </label>

      {error ? <p className="ghc-admin-error">{error}</p> : null}

      <div className="ghc-admin-form-actions">
        <button type="submit" disabled={busy || !csrf} className="ghc-btn-primary">
          {busy
            ? mode === 'create'
              ? t('form.submittingCreate')
              : t('form.submittingEdit')
            : mode === 'create'
              ? t('form.submitCreate')
              : t('form.submitEdit')}
        </button>
        {isEdit ? (
          <button
            type="button"
            onClick={() => void onPreview()}
            disabled={previewBusy || !csrf}
            className="ghc-btn-secondary"
          >
            {t('actions.preview')}
          </button>
        ) : null}
        {isEdit && onDelete ? (
          <button
            type="button"
            onClick={() => {
              if (confirm(t('actions.confirmDelete', { slug: state.slug }))) {
                void onDelete();
              }
            }}
            className="ghc-btn-danger"
          >
            {t('actions.delete')}
          </button>
        ) : null}
      </div>

      {previewError ? <p className="ghc-admin-error">{previewError}</p> : null}
      {preview ? (
        <section className="ghc-admin-card">
          <h3 className="ghc-admin-card-title">{t('actions.preview')}</h3>
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
                  <code>{s.owner}/{s.name}</code>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </form>
  );
}