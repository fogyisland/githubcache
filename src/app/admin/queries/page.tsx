import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import {
  totalRequests,
  cacheHitRate,
  avgLatency,
  activeApiKeyCount,
  topRepos,
  topKeys,
  recentRequests,
} from '@/lib/reports/queries';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { QueriesKpis } from './_components/queries-kpis';
import { QueriesDateRange } from './_components/queries-date-range';
import { TopQueriedReposTable } from './_components/top-queried-repos';
import { TopKeysTable } from './_components/top-keys-table';
import { RecentRequestsTable } from './_components/recent-requests-table';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

/**
 * Admin → Queries (M16).
 *
 * Drill-down view on top of /admin/reports. Same data sources (RequestLog,
 * ApiKey) plus a URL-driven date range picker and a paginated "recent
 * requests" table at the bottom. Visible to admin + operator (matches
 * /admin/reports).
 *
 * Date semantics: `<input type="date">` produces `YYYY-MM-DD` with no time.
 * We construct `from = midnight UTC` and `to = next midnight UTC` so the
 * `to`-date itself is included. Inconsistent with /admin/audit (which
 * treats `to` as exclusive midnight) but more intuitive for drill-down.
 */
export default async function AdminQueriesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; limit?: string; offset?: string }> }): Promise<ReactElement> {
  const sp = await searchParams;
  const t = await getTranslations('admin.queries');

  const cookieStore = await cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
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

  const userTz = await resolveRequestTimezone({ dbValue: user.timezone });

  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(sp.limit ?? PAGE_SIZE_DEFAULT)));
  const offset = Math.max(0, Number(sp.offset ?? 0));

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let from: Date = defaultFrom;
  if (sp.from) {
    const d = new Date(sp.from);
    if (!isNaN(d.getTime())) from = d;
  }
  let to: Date = now;
  if (sp.to) {
    const d = new Date(sp.to);
    if (!isNaN(d.getTime())) {
      // Bump to inclusive end-of-day so picking 2026-08-31 covers the whole day.
      to = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  const [total, hitRate, avg, activeKeys, repos, keys, recent] = await Promise.all([
    totalRequests(from, to),
    cacheHitRate(from, to),
    avgLatency(from, to),
    activeApiKeyCount(from, to),
    topRepos(from, to, 10),
    topKeys(from, to, 10),
    recentRequests({ skip: offset, take: limit }, { from, to }),
  ]);

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumb.admin'), href: '/admin' },
          { label: t('breadcrumb.queries') },
        ]}
        title={t('title')}
        description={t('description')}
      />
      <QueriesDateRange />
      <QueriesKpis
        totalRequests={total}
        cacheHitRate={hitRate}
        avgLatencyMs={avg}
        activeApiKeys={activeKeys}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopQueriedReposTable rows={repos} />
        <TopKeysTable
          rows={keys.map((k) => ({ ...k, keyId: k.keyId.toString() }))}
          tz={userTz}
        />
      </div>
      <RecentRequestsTable
        rows={recent.rows}
        total={recent.total}
        limit={limit}
        offset={offset}
        tz={userTz}
      />
    </div>
  );
}