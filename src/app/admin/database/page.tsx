import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { getDatabaseOverview, getTableStats } from '@/lib/database/overview';
import { getTableDetails } from '@/lib/database/tables';
import { topSlowQueries } from '@/lib/database/slow-queries';
import { listBackups } from '@/lib/database/backup';
import { getBinaryStatus, binariesReady } from '@/lib/database/binary-check';
import { env } from '@/lib/config/env';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { BinaryWarning } from './_components/binary-warning';
import { Overview } from './_components/overview';
import { BackupSection } from './_components/backup-section';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

interface BackupRowForClient {
  filename: string;
  size: number;
  mtime: string;
}
import { RestoreSection } from './_components/restore-section';
import { TablesSection } from './_components/tables-section';
import { SlowQueriesSection } from './_components/slow-queries-section';
import { PrismaStudioLink } from './_components/prisma-studio-link';

const SLOW_QUERY_LIMIT = 20;

/**
 * Admin → Database (M17).
 *
 * Single page that surfaces everything an operator needs to:
 *   - see DB version / host / total disk usage
 *   - back up the live DB to ./backups/
 *   - restore from a backup file (with blue/green RENAME swap +
 *     automatic pre-restore snapshot + RESTORE confirmation)
 *   - browse table schemas (columns + indexes)
 *   - see top 20 slow queries (when DB user has PROCESS privilege)
 *   - jump to Prisma Studio instructions
 *
 * Admin-only because the page exposes hashes, secrets, and live row
 * counts. Operators do not act on any of these signals.
 */
export default async function AdminDatabasePage(): Promise<ReactElement> {
  const t = await getTranslations('admin.database');

  const cookieStore = cookies();
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

  const userTz = resolveRequestTimezone({ dbValue: user.timezone });

  const [overview, tableStats, tableDetails, slow, backupsRaw, binaryStatus] =
    await Promise.all([
      getDatabaseOverview(),
      getTableStats(),
      getTableDetails(),
      topSlowQueries(SLOW_QUERY_LIMIT),
      listBackups(),
      Promise.resolve(getBinaryStatus()),
    ]);

  // Server-side BackupFileInfo has mtime: Date; the client component
  // wants mtime: ISO string for serialization. Normalize here so the
  // type contract stays narrow in both directions.
  const backups: BackupRowForClient[] = backupsRaw.map((b) => ({
    filename: b.filename,
    size: b.size,
    mtime: b.mtime.toISOString(),
  }));

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

      <BackupSection initialBackups={backups} keepN={env.BACKUP_KEEP_N} tz={userTz} />
      <RestoreSection backups={backups} />
      <TablesSection stats={tableStats} details={tableDetails} />
      <SlowQueriesSection result={slow} limit={SLOW_QUERY_LIMIT} />
      <PrismaStudioLink />
    </div>
  );
}
