import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { IMPORTABLE_TABLES } from '@/lib/import/tables';
import { ImportForm } from './_components/import-form';

/**
 * Admin → Import page (M32.7.7-b).
 *
 * One-off cross-database data import: paste a source MySQL connection
 * (same instance, different database), pick tables from the
 * whitelist, dry-run first to see what would land, then commit with
 * the `IMPORT` confirm word.
 *
 * Hardcoded INSERT IGNORE semantics — existing rows are preserved, no
 * overwrite.
 */
export default async function AdminImportPage(): Promise<ReactElement> {
  const t = await getTranslations('admin.import');
  await requireAdmin();

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.import') },
        ]}
        title={t('title')}
        description={t('description')}
      />

      <section className="ghc-admin-section">
        <ImportForm importableTables={[...IMPORTABLE_TABLES]} />
      </section>
    </div>
  );
}