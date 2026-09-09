import type { ReactElement } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import {
  fetchStatusBreakdown,
  languageDistribution,
  staleRepos,
} from '@/lib/reports/insights';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminKpiCard } from '@/app/admin/_components/admin-kpi-card';

const STALE_THRESHOLD_DAYS = 7;

/**
 * Admin → Insights hub (M18).
 *
 * Single landing page for the four sub-reports:
 *   - /admin/insights/top-repos  — popularity ranking (sortable + filterable)
 *   - /admin/insights/languages  — top-N language distribution bar list
 *   - /admin/insights/stale      — repos not refreshed within N days
 *   - /admin/insights/health     — fetch_status distribution + recent failures
 *
 * The hub surfaces the same KPI strip each sub-page computes locally, so
 * an admin can decide which drill-down to enter from a single glance.
 *
 * Admin-only because all four pages expose live cache contents.
 */
export default async function AdminInsightsHubPage(): Promise<ReactElement> {
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

  const [statusBreakdown, languages, stale] = await Promise.all([
    fetchStatusBreakdown(),
    languageDistribution(1000), // large limit — we only need a count below
    staleRepos({ thresholdDays: STALE_THRESHOLD_DAYS, skip: 0, take: 1 }),
  ]);

  const totalCached =
    statusBreakdown.ok +
    statusBreakdown.not_found +
    statusBreakdown.forbidden +
    statusBreakdown.error;
  const okSharePct =
    totalCached === 0 ? 0 : Math.round((statusBreakdown.ok / totalCached) * 1000) / 10;
  const languageCount = languages.length;

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.insights') },
        ]}
        title={t('title')}
        description={t('description')}
      />

      <section>
        <h2 className="ghc-admin-section-title">{t('hub.heading')}</h2>
        <div className="ghc-admin-kpi-grid">
          <AdminKpiCard
            label={t('hub.kpiCached')}
            value={totalCached}
            tone="default"
          />
          <AdminKpiCard
            label={t('hub.kpiOkShare')}
            value={`${okSharePct}%`}
            tone={okSharePct >= 80 ? 'positive' : 'negative'}
          />
          <AdminKpiCard label={t('hub.kpiLanguages')} value={languageCount} />
          <AdminKpiCard
            label={t('hub.kpiStale')}
            value={stale.total}
            tone={stale.total === 0 ? 'positive' : 'negative'}
          />
        </div>
      </section>

      <section>
        <h2 className="ghc-admin-section-title">{t('hub.cardsHeading')}</h2>
        <div className="ghc-admin-card-grid">
          <Link href="/admin/insights/top-repos" className="ghc-admin-card ghc-admin-card-link">
            <h3 className="ghc-admin-card-title">{t('hub.cardTopReposTitle')}</h3>
            <p className="ghc-admin-card-desc">{t('hub.cardTopReposDesc')}</p>
          </Link>
          <Link href="/admin/insights/languages" className="ghc-admin-card ghc-admin-card-link">
            <h3 className="ghc-admin-card-title">{t('hub.cardLanguagesTitle')}</h3>
            <p className="ghc-admin-card-desc">{t('hub.cardLanguagesDesc')}</p>
          </Link>
          <Link href="/admin/insights/stale" className="ghc-admin-card ghc-admin-card-link">
            <h3 className="ghc-admin-card-title">{t('hub.cardStaleTitle')}</h3>
            <p className="ghc-admin-card-desc">{t('hub.cardStaleDesc')}</p>
          </Link>
          <Link href="/admin/insights/health" className="ghc-admin-card ghc-admin-card-link">
            <h3 className="ghc-admin-card-title">{t('hub.cardHealthTitle')}</h3>
            <p className="ghc-admin-card-desc">{t('hub.cardHealthDesc')}</p>
          </Link>
        </div>
      </section>
    </div>
  );
}
