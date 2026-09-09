import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { listProviders } from '@/lib/ingestion/providers/db';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';

/**
 * Admin → Providers (M19.8).
 *
 * Admin-only. Lists configured ingestion providers with their source
 * type + enabled status. Each row links to /admin/providers/[id] for
 * edit/delete/toggle; the page header exposes a New button.
 *
 * Read-only — CRUD happens on the detail page (M19.9). The card on
 * /admin/ingestion handles preview/run (M19.10).
 */
type ProviderRow = NonNullable<Awaited<ReturnType<typeof listProviders>>>[number];

export default async function AdminProvidersPage(): Promise<ReactElement> {
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
  const rows = await listProviders();

  const columns: AdminColumn<ProviderRow>[] = [
    {
      key: 'name',
      header: t('list.column.name'),
      render: (p) => (
        <Link href={`/admin/providers/${p.id.toString()}`} className="ghc-link">
          {p.name}
        </Link>
      ),
    },
    {
      key: 'slug',
      header: t('list.column.slug'),
      render: (p) => <code className="ghc-admin-mono">{p.slug}</code>,
    },
    {
      key: 'sourceType',
      header: t('list.column.sourceType'),
      render: (p) => t(`sourceType.${p.sourceType}` as 'sourceType.json'),
    },
    {
      key: 'status',
      header: t('list.column.status'),
      render: (p) => (
        <AdminStatusChip variant={p.enabled ? 'ok' : 'neutral'}>
          {t(p.enabled ? 'status.enabled' : 'status.disabled')}
        </AdminStatusChip>
      ),
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumbAdmin'), href: '/admin' },
          { label: t('breadcrumbProviders') },
        ]}
        title={t('title')}
        description={t('description')}
        actions={
          <Link href="/admin/providers/new" className="ghc-btn-primary">
            {t('form.submitCreate')}
          </Link>
        }
      />
      <section>
        <h2 className="ghc-admin-section-title">
          {t('list.heading')}{' '}
          <span className="ghc-admin-section-count">({rows.length})</span>
        </h2>
        <AdminTable<ProviderRow>
          columns={columns}
          rows={rows}
          emptyTitle={t('list.emptyTitle')}
          emptyDescription={t('list.emptyDescription')}
        />
      </section>
    </div>
  );
}