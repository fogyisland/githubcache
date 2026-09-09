import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { ApiSettingsForm } from './_components/api-settings-form';
import { readTunables } from '@/lib/config/settings-store';

/**
 * Admin → API settings (M28.api-settings).
 *
 * One place to tune:
 *   - GitHub query cadence (scheduler tick + per-facet sweep cadences
 *     + token auto-disable threshold)
 *   - Public API rate limits (per-IP + per-key)
 *
 * Persistence model: writes to .env via `settings-store`. The in-process
 * env cache is invalidated so the next read sees the new value, but
 * the long-running scheduler / pool keep their captured values until
 * restart. The UI surfaces a "restart required" toast after every save
 * so the operator knows.
 *
 * Admin-only.
 */
export default async function AdminApiSettingsPage(): Promise<ReactElement> {
  const t = await getTranslations('admin.apiSettings');

  await requireAdmin();

  const current = readTunables();

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.apiSettings') },
        ]}
        title={t('title')}
        description={t('description')}
      />

      <section>
        <h2 className="ghc-admin-section-title">{t('github.heading')}</h2>
        <p className="ghc-admin-section-desc">{t('github.description')}</p>
        <div className="ghc-api-settings-card">
          <ApiSettingsForm section="github" current={current} />
        </div>
      </section>

      <section>
        <h2 className="ghc-admin-section-title">{t('publicApi.heading')}</h2>
        <p className="ghc-admin-section-desc">{t('publicApi.description')}</p>
        <div className="ghc-api-settings-card">
          <ApiSettingsForm section="api" current={current} />
        </div>
      </section>
    </div>
  );
}