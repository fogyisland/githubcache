import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { languageDistribution } from '@/lib/reports/insights';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';

const TOP_N = 20;

/**
 * Admin → Insights → Languages (M18).
 *
 * Top programming languages by cached-repo count, with share percentage.
 * Read-only snapshot — no history tracking (M18 is snapshot-only).
 *
 * Renders as a simple flexbox bar list (CSS `.ghc-admin-bar-list` + bar
 * widths set inline from sharePct). Avoids adding a chart library for one
 * screen of data.
 */
export default async function AdminInsightsLanguagesPage(): Promise<ReactElement> {
  const t = await getTranslations('insights');

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

  const buckets = await languageDistribution(TOP_N);
  const maxShare = buckets.reduce((acc, b) => Math.max(acc, b.sharePct), 0);

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.insights'), href: '/admin/insights' },
          { label: t('languages.heading') },
        ]}
        title={t('languages.heading')}
        description={t('languages.description', { limit: TOP_N })}
      />

      {buckets.length === 0 ? (
        <p className="ghc-admin-empty">{t('languages.empty')}</p>
      ) : (
        <ul className="ghc-admin-bar-list" aria-label={t('languages.heading')}>
          {buckets.map((b) => {
            // Bar width is proportional to the largest bucket so the leader
            // is always 100%; smaller buckets scale down naturally.
            const widthPct = maxShare === 0 ? 0 : (b.sharePct / maxShare) * 100;
            return (
              <li key={b.key} className="ghc-admin-bar-list-row">
                <div className="ghc-admin-bar-list-label">{b.key}</div>
                <div className="ghc-admin-bar-list-bar" aria-hidden="true">
                  <div
                    className="ghc-admin-bar-list-fill"
                    style={{ width: `${widthPct.toFixed(2)}%` }}
                  />
                </div>
                <div className="ghc-admin-bar-list-meta">
                  <span>{t('languages.count', { count: b.count })}</span>
                  <span className="ghc-admin-bar-list-share">
                    {t('languages.share', { pct: b.sharePct.toFixed(1) })}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
