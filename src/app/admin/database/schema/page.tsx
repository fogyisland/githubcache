import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { getTableStats } from '@/lib/database/overview';
import { getTableDetails } from '@/lib/database/tables';
import { getMigrationStatus } from '@/lib/database/migrations';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminDatabaseTabs } from '../_components/admin-database-tabs';
import { TablesSection } from '../_components/tables-section';
import { SchemaUpgrade } from '../_components/schema-upgrade';

interface MigrationRowForClient {
  name: string;
  timestamp: string;
  slug: string;
  applied: boolean;
  finishedAt: string | null;
}

/**
 * Admin → Database → Schema (M28.bug28).
 *
 * Read-only view of every table's columns, indexes, and the full
 * Prisma migration history. Schema-upgrade button lives at the
 * bottom because it's the only mutating action on this page.
 */
export default async function AdminDatabaseSchemaPage(): Promise<ReactElement> {
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

  const [tableStats, tableDetails, migrations] = await Promise.all([
    getTableStats(),
    getTableDetails(),
    getMigrationStatus(),
  ]);

  // Server-side `Date` → ISO for the client-island serialization.
  const migrationRows: MigrationRowForClient[] = migrations.map((m) => ({
    name: m.name,
    timestamp: m.timestamp,
    slug: m.slug,
    applied: m.applied,
    finishedAt: m.finishedAt ? m.finishedAt.toISOString() : null,
  }));

  const pathname = (await headers()).get('x-pathname') ?? '/admin/database/schema';

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.database'), href: '/admin/database' },
          { label: t('breadcrumb.schema') },
        ]}
        title={t('schema.title')}
        description={t('schema.description')}
      />

      <AdminDatabaseTabs pathname={pathname} />

      <TablesSection stats={tableStats} details={tableDetails} />
      <SchemaUpgrade initialMigrations={migrationRows} />
    </div>
  );
}