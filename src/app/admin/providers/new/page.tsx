import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { ProviderForm } from '../_components/provider-form';

/**
 * Admin → Providers → New (M19.9).
 *
 * Admin-only. Renders the create-mode provider form.
 */
export default async function NewProviderPage(): Promise<ReactElement> {
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