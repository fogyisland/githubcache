import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { listBackups } from '@/lib/database/backup';
import { topSlowQueries } from '@/lib/database/slow-queries';
import { getBinaryStatus, binariesReady } from '@/lib/database/binary-check';
import { env } from '@/lib/config/env';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminDatabaseTabs } from '../_components/admin-database-tabs';
import { BinaryWarning } from '../_components/binary-warning';
import { BackupSection } from '../_components/backup-section';
import { RestoreSection } from '../_components/restore-section';
import { SlowQueriesSection } from '../_components/slow-queries-section';
import { PrismaStudioLink } from '../_components/prisma-studio-link';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

interface BackupRowForClient {
  filename: string;
  size: number;
  mtime: string;
}

const SLOW_QUERY_LIMIT = 20;

/**
 * Admin → Database → Operations (M28.bug28).
 *
 * Backup + restore + slow queries + binary-warning all in one
 * because they're operator actions on the live DB and they share
 * the same TZ-aware backup file list. Schema (read-only table
 * schemas + migrations) lives at /admin/database/schema instead.
 */
export default async function AdminDatabaseOperationsPage(): Promise<ReactElement> {
  const t = await getTranslations('admin.database');

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

  const userTz = await resolveRequestTimezone({ dbValue: user.timezone });

  const [backupsRaw, slow, binaryStatus] = await Promise.all([
    listBackups(),
    topSlowQueries(SLOW_QUERY_LIMIT),
    Promise.resolve(getBinaryStatus()),
  ]);

  // Normalize Date → ISO for the client island boundary.
  const backups: BackupRowForClient[] = backupsRaw.map((b) => ({
    filename: b.filename,
    size: b.size,
    mtime: b.mtime.toISOString(),
  }));

  const pathname = (await headers()).get('x-pathname') ?? '/admin/database/operations';

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.database'), href: '/admin/database' },
          { label: t('breadcrumb.operations') },
        ]}
        title={t('operations.title')}
        description={t('operations.description')}
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

      <BackupSection initialBackups={backups} keepN={env.BACKUP_KEEP_N} tz={userTz} />
      <RestoreSection backups={backups} />
      <SlowQueriesSection result={slow} limit={SLOW_QUERY_LIMIT} />
      <PrismaStudioLink />
    </div>
  );
}