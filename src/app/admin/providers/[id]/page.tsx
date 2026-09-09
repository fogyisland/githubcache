import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { getProviderById } from '@/lib/ingestion/providers/db';
import { ProviderConfigSchema, type ProviderConfig } from '@/lib/ingestion/providers/schema';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { ProviderForm } from '../_components/provider-form';
import { ProviderToggle } from './_components/provider-actions';
import { ProviderDelete } from './_components/provider-delete';

function parseId(idParam: string): bigint | null {
  try {
    return BigInt(idParam);
  } catch {
    return null;
  }
}

/**
 * Admin → Providers → Detail (M19.9).
 *
 * Admin-only. Edit form pre-filled with current values plus Delete
 * and Toggle actions.
 */
export default async function ProviderDetailPage({
  params,
}: {
  params: { id: string };
}): Promise<ReactElement> {
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

  const id = parseId(params.id);
  if (!id) {
    redirect('/admin/providers');
  }

  const row = await getProviderById(id);
  if (!row) {
    redirect('/admin/providers');
  }

  const t = await getTranslations('admin.providers');
  const config = ProviderConfigSchema.parse(row.configJson) as ProviderConfig;

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumbAdmin'), href: '/admin' },
          { label: t('breadcrumbProviders'), href: '/admin/providers' },
          { label: row.name },
        ]}
        title={t('form.editHeading')}
        description={t('description')}
        actions={
          <div className="ghc-admin-page-actions-row">
            <ProviderToggle providerId={row.id.toString()} enabled={row.enabled} />
            <ProviderDelete providerId={row.id.toString()} slug={row.slug} />
          </div>
        }
      />
      <ProviderForm
        mode="edit"
        initial={{
          id: row.id.toString(),
          slug: row.slug,
          name: row.name,
          kind: config.kind,
          path: config.kind === 'file' ? config.path : '',
          url: config.kind === 'http' ? config.url : '',
          itemsPath: config.itemsPath,
          urlField: config.urlField,
          enabled: row.enabled,
        }}
      />
    </div>
  );
}