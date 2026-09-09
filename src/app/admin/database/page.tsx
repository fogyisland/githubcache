import type { ReactElement } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getDatabaseOverview } from '@/lib/database/overview';
import { getBinaryStatus, binariesReady } from '@/lib/database/binary-check';
import { listBackups } from '@/lib/database/backup';
import { requireAdmin } from '@/lib/auth/require-admin';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminDatabaseTabs } from './_components/admin-database-tabs';
import { BinaryWarning } from './_components/binary-warning';
import { AdminKpiCard } from '@/app/admin/_components/admin-kpi-card';
import { DatabaseHealthCard } from './_components/database-health-card';
import { formatDateTime } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

/**
 * Admin → Database overview (M28.bug28).
 *
 * One-glance health view: KPI strip + binary check + last backup.
 * Sub-pages do the work — see the tabs bar.
 */
export default async function AdminDatabasePage(): Promise<ReactElement> {
  const t = await getTranslations('admin.database');
  const { user, pathname } = await requireAdmin();
  const userTz = await resolveRequestTimezone({ dbValue: user.timezone });

  const [overview, binaryStatus, backups] = await Promise.all([
    getDatabaseOverview(),
    Promise.resolve(getBinaryStatus()),
    listBackups(),
  ]);

  // The most recent successful backup is what the operator really
  // cares about — "when was I last safe?".
  const lastBackup = backups[0] ?? null;

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.database') },
        ]}
        title={t('title')}
        description={t('description')}
      />

      <AdminDatabaseTabs pathname={pathname} />

      <section className="ghc-admin-section">
        <h2 className="ghc-admin-section-title">{t('overview.heading')}</h2>
        <div className="ghc-admin-kpi-grid">
          <AdminKpiCard label={t('overview.version')} value={overview.version} />
          <AdminKpiCard label={t('overview.host')} value={overview.host} />
          <AdminKpiCard label={t('overview.port')} value={String(overview.port)} />
          <AdminKpiCard
            label={t('overview.tableCount')}
            value={overview.tableCount}
            tone="default"
          />
        </div>
      </section>

      <DatabaseHealthCard
        lastBackupAt={lastBackup ? formatDateTime(lastBackup.mtime, userTz) : null}
        lastBackupFilename={lastBackup?.filename ?? null}
        totalBytes={overview.totalBytes}
      />

      {!binariesReady() ? (
        <BinaryWarning
          mysqldumpAvailable={binaryStatus.mysqldump.available}
          gzipAvailable={binaryStatus.gzip.available}
          mysqldumpError={binaryStatus.mysqldump.error}
          gzipError={binaryStatus.gzip.error}
        />
      ) : null}

      <section className="ghc-admin-section">
        <h2 className="ghc-admin-section-title">{t('landing.quickHeading')}</h2>
        <nav className="ghc-admin-quick-nav" aria-label={t('landing.quickHeading')}>
          <Link href="/admin/database/schema" className="ghc-admin-quick-link">
            <span className="ghc-admin-quick-link-title">{t('landing.schemaCardTitle')}</span>
            <span className="ghc-admin-quick-link-desc">{t('landing.schemaCardDesc')}</span>
            <span className="ghc-admin-quick-link-arrow" aria-hidden="true">→</span>
          </Link>
          <Link href="/admin/database/operations" className="ghc-admin-quick-link">
            <span className="ghc-admin-quick-link-title">{t('landing.operationsCardTitle')}</span>
            <span className="ghc-admin-quick-link-desc">{t('landing.operationsCardDesc')}</span>
            <span className="ghc-admin-quick-link-arrow" aria-hidden="true">→</span>
          </Link>
        </nav>
      </section>
    </div>
  );
}
