import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

interface Props {
  version: string;
  host: string;
  database: string;
  port: number;
  tableCount: number;
  totalBytes: number;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1)} ${units[u]}`;
}

/**
 * M17 — Server-rendered KPI strip on /admin/database. All values
 * come from information_schema queries so they're authoritative
 * (no caching, no estimation).
 */
export async function Overview({
  version,
  host,
  database,
  port,
  tableCount,
  totalBytes,
}: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.database.overview');
  return (
    <section className="ghc-admin-section">
      <h2 className="ghc-admin-section-title">{t('heading')}</h2>
      <dl className="ghc-admin-kv-grid">
        <div>
          <dt>{t('version')}</dt>
          <dd>{version}</dd>
        </div>
        <div>
          <dt>{t('host')}</dt>
          <dd>
            {host}:{port}
          </dd>
        </div>
        <div>
          <dt>{t('database')}</dt>
          <dd>{database}</dd>
        </div>
        <div>
          <dt>{t('tableCount')}</dt>
          <dd>{tableCount}</dd>
        </div>
        <div>
          <dt>{t('totalBytes')}</dt>
          <dd>{formatBytes(totalBytes)}</dd>
        </div>
      </dl>
    </section>
  );
}
