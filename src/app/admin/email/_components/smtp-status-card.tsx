'use client';

import { useEffect, useState, useTransition, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { fetchCsrfToken } from '@/lib/csrf/client';
import { testEmailConnection, type TestConnectionState } from '../_actions/test-connection';

interface StatusCardProps {
  configured: boolean;
  totalLast24h: number;
  sentLast24h: number;
  failedLast24h: number;
  lastSuccessAt: string | null;
}

/**
 * M28 — SMTP status overview card for /admin/email.
 *
 * One-glance read of:
 *  - configuration status (green dot + "Configured" / amber dot + "Not configured")
 *  - 24h send counts (sent / failed)
 *  - last successful send
 *  - "Test connection" button — runs nodemailer.verify() in <2s
 *
 * Result is rendered as an inline alert with the latency in ms. No
 * page reload — the parent server component revalidates after the
 * action via revalidatePath inside the server action.
 */
export function SmtpStatusCard(props: StatusCardProps): ReactElement {
  const t = useTranslations('admin.email.status');
  const [csrf, setCsrf] = useState('');
  const [result, setResult] = useState<TestConnectionState>({ status: 'idle' });
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void fetchCsrfToken()
      .then(setCsrf)
      .catch(() => {
        // retry on next click — fetchCsrfToken self-heals.
      });
  }, []);

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (!csrf) return;
    const fd = new FormData();
    fd.set('csrf', csrf);
    startTransition(async () => {
      const next = await testEmailConnection(result, fd);
      setResult(next);
    });
  }

  return (
    <div className="ghc-smtp-status-card" data-configured={props.configured ? 'yes' : 'no'}>
      <div className="ghc-smtp-status-row">
        <div className="ghc-smtp-status-indicator" aria-hidden="true">
          <span className={`ghc-smtp-dot ghc-smtp-dot-${props.configured ? 'ok' : 'warn'}`} />
        </div>
        <div className="ghc-smtp-status-meta">
          <div className="ghc-smtp-status-headline">
            {props.configured ? t('configured') : t('notConfigured')}
          </div>
          <div className="ghc-smtp-status-subline">
            {props.lastSuccessAt
              ? t('lastSent', { when: formatRelative(props.lastSuccessAt) })
              : t('neverSent')}
          </div>
        </div>
        <div className="ghc-smtp-stats" aria-label={t('statsAria')}>
          <Stat label={t('stat.sent24h')} value={props.sentLast24h} tone="ok" />
          <Stat
            label={t('stat.failed24h')}
            value={props.failedLast24h}
            tone={props.failedLast24h > 0 ? 'danger' : 'neutral'}
          />
        </div>
        <form onSubmit={onSubmit} className="ghc-smtp-test-form">
          <input type="hidden" name="csrf" value={csrf} />
          <button type="submit" className="ghc-btn-secondary" disabled={pending || !csrf}>
            {pending ? t('testing') : t('testConnection')}
          </button>
        </form>
      </div>

      {result.status === 'ok' && (
        <div className="ghc-smtp-test-result ghc-smtp-test-result-ok" role="status">
          {t('testOk', { ms: result.latencyMs ?? 0 })}
        </div>
      )}
      {result.status === 'failed' && (
        <div className="ghc-smtp-test-result ghc-smtp-test-result-fail" role="alert">
          {t('testFailed', { error: result.message ?? 'unknown' })}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'danger' | 'neutral';
}): ReactElement {
  return (
    <div className="ghc-smtp-stat" data-tone={tone}>
      <div className="ghc-smtp-stat-value">{value.toLocaleString()}</div>
      <div className="ghc-smtp-stat-label">{label}</div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}