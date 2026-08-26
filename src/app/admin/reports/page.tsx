import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { validateSession } from '@/lib/auth/session';
import {
  totalRequests,
  cacheHitRate,
  avgLatency,
  activeApiKeyCount,
  requestsOverTime,
  topRepos,
  topKeys,
  tokenQuotaUsage,
} from '@/lib/reports/queries';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { KpiCards } from './_components/kpi-cards';
import { RequestsOverTimeChart } from './_components/requests-over-time-chart';
import { TopReposTable } from './_components/top-repos-table';
import { TopKeysTable } from './_components/top-keys-table';
import { TokenQuotaTable } from './_components/token-quota-table';

/**
 * Admin → Reports page (M7.4).
 *
 * Server component. Fetches all aggregations in parallel (Promise.all) and
 * passes them to client components for chart rendering. The 5 widgets:
 *   1. KPI cards (total, hit rate, avg latency, active keys)
 *   2. Requests over time (Recharts line chart, hourly buckets, 24h)
 *   3. Top repositories (table, top 10)
 *   4. Top API keys (table, top 10)
 *   5. Token quota usage (table, all tokens)
 *
 * TODO(M7.4): Date range picker (from/to) — deferred. Currently fixed to
 * last 24h. Future iteration: client-side picker that re-fetches via
 * /api/admin/reports?window=1h|24h|7d|custom.
 */
export default async function AdminReportsPage(): Promise<ReactElement> {
  // Auth gate — admin OR operator (per spec §9.1)
  const cookieStore = cookies();
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

  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);

  const [total, hitRate, avg, activeKeys, overTime, repos, keys, quota] = await Promise.all([
    totalRequests(from, to),
    cacheHitRate(from, to),
    avgLatency(from, to),
    activeApiKeyCount(from, to),
    requestsOverTime(from, to),
    topRepos(from, to, 10),
    topKeys(from, to, 10),
    tokenQuotaUsage(),
  ]);

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[{ label: 'Admin', href: '/admin' }, { label: 'Reports' }]}
        title="Reports"
        description="Aggregated usage, cache performance, and quota over the last 24 hours."
      />
      <KpiCards
        totalRequests={total}
        cacheHitRate={hitRate}
        avgLatencyMs={avg}
        activeApiKeys={activeKeys}
      />
      <RequestsOverTimeChart data={overTime} />
      <TopReposTable rows={repos} />
      <TopKeysTable rows={keys.map((k) => ({ ...k, keyId: k.keyId.toString() }))} />
      <TokenQuotaTable rows={quota.map((t) => ({ ...t, id: t.id.toString() }))} />
    </div>
  );
}