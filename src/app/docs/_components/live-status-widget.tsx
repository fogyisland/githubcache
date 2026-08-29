import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { collectV1Status } from '@/lib/api-docs/v1-status';

/**
 * Compact live snapshot of /api/v1/status for the docs landing page (M14.3).
 *
 * Server component — calls collectV1Status() once per render. We do NOT
 * HTTP-fetch /api/v1/status; the helper inlines the same DB queries so the
 * widget never depends on a self-loopback base URL.
 *
 * When the DB is down (`collectV1Status()` returns null), the widget still
 * renders a banner with the down state so operators see a single source of
 * truth for "is the service up" without leaving the docs.
 */
export async function LiveStatusWidget(): Promise<ReactElement> {
  const t = await getTranslations('docs.landing.liveStatus');
  const status = await collectV1Status();

  // Degraded render — DB unreachable.
  if (status === null) {
    return (
      <section className="ghc-doc-section" aria-labelledby="ghc-doc-live-status-heading">
        <h2 className="ghc-doc-h2" id="ghc-doc-live-status-heading">
          {t('heading')}
        </h2>
        <p>{t('body')}</p>
        <div className="ghc-doc-live-status-grid">
          <Field label={t('fields.ok')} value="—" tone="down" />
          <Field label={t('fields.db')} value={t('values.down')} tone="down" />
        </div>
      </section>
    );
  }

  return (
    <section className="ghc-doc-section" aria-labelledby="ghc-doc-live-status-heading">
      <h2 className="ghc-doc-h2" id="ghc-doc-live-status-heading">
        {t('heading')}
      </h2>
      <p>{t('body')}</p>
      <div className="ghc-doc-live-status-grid">
        <Field
          label={t('fields.ok')}
          value={status.ok ? t('values.up') : t('values.down')}
          tone={status.ok ? 'up' : 'down'}
        />
        <Field
          label={t('fields.db')}
          value={status.db === 'up' ? t('values.up') : t('values.down')}
          tone={status.db === 'up' ? 'up' : 'down'}
        />
        <Field label={t('fields.tokensActive')} value={String(status.tokens.active)} />
        <Field label={t('fields.tokensExhausted')} value={String(status.tokens.exhausted)} />
        <Field label={t('fields.queuePending')} value={String(status.queue.pending)} />
        <Field label={t('fields.queueFailed')} value={String(status.queue.failed)} />
        <Field label={t('fields.reposTotal')} value={String(status.repositories.total)} />
      </div>
    </section>
  );
}

interface FieldProps {
  label: string;
  value: string;
  tone?: 'up' | 'down';
}

function Field({ label, value, tone }: FieldProps): ReactElement {
  const toneClass =
    tone === 'up'
      ? 'ghc-doc-live-status-tone-up'
      : tone === 'down'
        ? 'ghc-doc-live-status-tone-down'
        : '';
  return (
    <a
      href="/api/v1/status"
      className={`ghc-doc-live-status-field ${toneClass}`.trim()}
      title="Open raw JSON"
    >
      <span className="ghc-doc-live-status-field-label">{label}</span>
      <span className="ghc-doc-live-status-field-value">{value}</span>
    </a>
  );
}
