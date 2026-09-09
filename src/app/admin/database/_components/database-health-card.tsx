'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactElement } from 'react';

interface HealthCardProps {
  lastBackupAt: string | null;
  lastBackupFilename: string | null;
  totalBytes: number | null;
}

/**
 * M28 — one-glance "is the DB healthy?" card on /admin/database.
 *
 * Combines last-backup + disk-usage in a single dark-mode-aware
 * panel. If a backup is older than 25h, shows a warning dot so the
 * operator notices at a glance (the page itself can sit on screen
 * for hours during incident response).
 */
export function DatabaseHealthCard({
  lastBackupAt,
  lastBackupFilename,
  totalBytes,
}: HealthCardProps): ReactElement {
  const t = useTranslations('admin.database.health');
  // "stale" if last backup > 25h ago. Computed client-side so the
  // dot updates without a server roundtrip when the page sits open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const ageMs = lastBackupAt ? now - new Date(lastBackupAt).getTime() : null;
  const stale = ageMs !== null && ageMs > 25 * 60 * 60 * 1000;

  const tone = lastBackupAt === null
    ? 'danger'
    : stale
      ? 'warn'
      : 'ok';

  return (
    <div className="ghc-db-health" data-tone={tone}>
      <div className="ghc-db-health-row">
        <div className="ghc-db-health-marker" aria-hidden="true">
          <span className={`ghc-db-health-dot ghc-db-health-dot-${tone}`} />
        </div>
        <div className="ghc-db-health-meta">
          <div className="ghc-db-health-label">{t('lastBackup')}</div>
          <div className="ghc-db-health-value">
            {lastBackupAt ?? t('never')}
          </div>
          {lastBackupFilename ? (
            <code className="ghc-admin-mono ghc-db-health-filename">
              {lastBackupFilename}
            </code>
          ) : null}
        </div>
        <div className="ghc-db-health-meta">
          <div className="ghc-db-health-label">{t('diskUsage')}</div>
          <div className="ghc-db-health-value">
            {totalBytes !== null ? formatBytes(totalBytes) : '—'}
          </div>
        </div>
        <div className="ghc-db-health-actions">
          <Link href="/admin/database/operations" className="ghc-btn-secondary ghc-btn-sm">
            {t('backUpNow')}
          </Link>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
