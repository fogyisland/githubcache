import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { ProviderForm } from '../_components/provider-form';

/**
 * Admin → Providers → New (M19.9).
 *
 * Admin-only. Renders the create-mode provider form.
 */
export default async function NewProviderPage(): Promise<ReactElement> {
  await requireAdmin();

  const t = await getTranslations('admin.providers');

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumbAdmin'), href: '/admin' },
          { label: t('breadcrumbProviders'), href: '/admin/providers' },
          { label: t('form.createHeading') },
        ]}
        title={t('form.createHeading')}
        description={t('description')}
      />
      <ProviderForm mode="create" />
    </div>
  );
}