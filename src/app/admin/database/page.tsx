import type { ReactElement } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { getDatabaseOverview } from '@/lib/database/overview';
import { getBinaryStatus, binariesReady } from '@/lib/database/binary-check';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminKpiCard } from '@/app/admin/_components/admin-kpi-card';
import { Overview } from './_components/overview';
import { BinaryWarning } from './_components/binary-warning';
import { AdminDatabaseTabs } from './_components/admin-database-tabs';

/**
 * Admin → Database overview (M28.bug28).
 *
 * Landing page. Loads only the data the overview card needs
 * (DB version + table count + disk usage + binary status) and
 * forwards operators to the dedicated sub-pages:
 *   - /admin/database/schema     → tables, indexes, migrations
 *   - /admin/database/operations → backups, restore, slow queries
 *
 * Each sub-page does its own scoped data fetch — opening
 * /admin/database/schema no longer pulls the slow-query log
 * or backup directory like the old single-page version did.
 */
export default async function AdminDatabasePage(): Promise<ReactElement> {
  const t = await getTranslations('admin.database');

  // Layout already gates auth; this page also re-validates as defense
  // in depth (the file is force-dynamic so the cookie lookup is fresh).
  const cookieStore = await cookies();
  const cookieMap = Object.fromEntries(
    cookieStore.getAll().map((c) => [c.name, c.value]),
  );
  const user = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!user) {
    redirect('/login');
  }
  if (user.role !== 'admin') {
    redirect('/admin');
  }

  const [overview, binaryStatus] = await Promise.all([
    getDatabaseOverview(),
    Promise.resolve(getBinaryStatus()),
  ]);

  const pathname = (await headers()).get('x-pathname') ?? '/admin/database';

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

      {!binariesReady() ? (
        <BinaryWarning
          mysqldumpAvailable={binaryStatus.mysqldump.available}
          gzipAvailable={binaryStatus.gzip.available}
          mysqldumpError={binaryStatus.mysqldump.error}
          gzipError={binaryStatus.gzip.error}
        />
      ) : null}

      <Overview
        version={overview.version}
        host={overview.host}
        database={overview.databaseName}
        port={overview.port}
        tableCount={overview.tableCount}
        totalBytes={overview.totalBytes}
      />

      <section>
        <h2 className="ghc-admin-section-title">{t('landing.quickHeading')}</h2>
        <div className="ghc-admin-card-grid">
          <Link href="/admin/database/schema" className="ghc-admin-card ghc-admin-card-link">
            <h3 className="ghc-admin-card-title">{t('landing.schemaCardTitle')}</h3>
            <p className="ghc-admin-card-desc">{t('landing.schemaCardDesc')}</p>
          </Link>
          <Link href="/admin/database/operations" className="ghc-admin-card ghc-admin-card-link">
            <h3 className="ghc-admin-card-title">{t('landing.operationsCardTitle')}</h3>
            <p className="ghc-admin-card-desc">{t('landing.operationsCardDesc')}</p>
          </Link>
        </div>
      </section>
    </div>
  );
}