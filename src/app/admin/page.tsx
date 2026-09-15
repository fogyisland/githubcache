import type { ReactElement } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminKpiCard } from '@/app/admin/_components/admin-kpi-card';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { queryAuditLog, getActorEmails } from '@/lib/db/audit';
import { loadDashboardBuckets, getDashboardCounts } from '@/lib/admin/dashboard-buckets';
import { loadGithubRequestVolume } from '@/lib/admin/github-request-volume';
import { formatTime } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';
import { GithubRequestVolumeChart } from './_components/github-request-volume-chart';
import { GithubRequestVolumeWindowSwitcher } from './_components/github-request-volume-window-switcher';

/**
 * Admin dashboard (M11.9 rewrite + M13.3 translation).
 *
 * Layout (top → bottom):
 *   1. AdminPageHeader — Dashboard + no actions (root of admin tree)
 *   2. 4 KPI cards: cached repos / active users / active api keys /
 *      active github tokens (with hint line)
 *   3. Two-column grid: requests-by-hour (last 6h, 1h buckets) + recent
 *      activity feed (top 5 audit entries)
 *   4. M32.7.6 — full-width GitHub upstream API request volume chart
 *      (24h or 7d, picked via ?window= search param).
 *
 * Data is fetched in parallel via Promise.all. The page is async SSR;
 * no client-side fetch needed.
 *
 * M30 — the 4 KPI counts are now produced by a single `getDashboardCounts`
 * `$queryRaw` aggregate (one round-trip instead of four parallel
 * prisma.count calls). Recent-audit lookup still uses `queryAuditLog`
 * because it also needs actor emails for the activity feed.
 */
export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}): Promise<ReactElement> {
  const sp = await searchParams;
  const t = await getTranslations('admin.shell.dashboard');

  // Dashboard doesn't validate its own session (layout.tsx gates auth),
  // so we read timezone from cookie/default only — no DB roundtrip.
  const userTz = await resolveRequestTimezone({});

  // M32.7.6 — pick the chart window. Anything other than '7d' falls
  // back to '24h' so a typo / stale link / unknown value can't 404.
  const window: '24h' | '7d' = sp.window === '7d' ? '7d' : '24h';

  const [counts, recentAudit, buckets, githubVolume] = await Promise.all([
    getDashboardCounts(),
    queryAuditLog({ limit: 5, offset: 0 }),
    loadDashboardBuckets((hours) =>
      t('chart.hoursAgo', { hours: String(hours) }),
    ),
    loadGithubRequestVolume(window),
  ]);
  const { cachedRepos, activeUsers, activeApiKeys, activeGithubTokens } = counts;

  const actorIds = [
    ...new Set(
      recentAudit.rows
        .map((r) => r.actorUserId)
        .filter((id): id is bigint => id !== null),
    ),
  ];
  const actorEmails = await getActorEmails(actorIds);

  const peak = Math.max(1, ...buckets.map((b) => b.count));
  const totalRecent = buckets.reduce((a, b) => a + b.count, 0);

  return (
    <div className="ghc-admin-dashboard">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumbAdmin'), href: '/admin' },
          { label: t('breadcrumbDashboard') },
        ]}
        title={t('title')}
        description={t('description')}
      />

      <section className="ghc-admin-kpi-row">
        <AdminKpiCard
          label={t('kpi.cachedRepos')}
          value={cachedRepos}
          hint={cachedRepos === 0 ? t('kpi.empty') : t('kpi.totalInCache')}
        />
        <AdminKpiCard
          label={t('kpi.activeUsers')}
          value={activeUsers}
          tone={activeUsers > 0 ? 'positive' : 'default'}
          hint={t('kpi.usersHint')}
        />
        <AdminKpiCard
          label={t('kpi.activeApiKeys')}
          value={activeApiKeys}
          tone={activeApiKeys > 0 ? 'positive' : 'default'}
          hint={t('kpi.apiKeysHint')}
        />
        <AdminKpiCard
          label={t('kpi.activeGithubTokens')}
          value={activeGithubTokens}
          tone={activeGithubTokens === 0 ? 'negative' : 'positive'}
          hint={t('kpi.githubTokensHint')}
        />
      </section>

      <section className="ghc-admin-dashboard-grid">
        <div className="ghc-admin-dashboard-card">
          <h2 className="ghc-admin-dashboard-card-title">{t('chart.title')}</h2>
          <p className="ghc-admin-dashboard-card-hint">
            {t('chart.totalRecent', { count: totalRecent.toLocaleString() })} · peak {peak.toLocaleString()}/hr
          </p>
          <div className="ghc-admin-dashboard-bars" role="img" aria-label={`Bar chart: ${buckets.map((b) => `${b.label} ${b.count}`).join(', ')}`}>
            {buckets.map((b) => {
              const pct = Math.round((b.count / peak) * 100);
              return (
                <div key={b.start.toISOString()} className="ghc-admin-dashboard-bar-col">
                  <div className="ghc-admin-dashboard-bar-track">
                    <div
                      className="ghc-admin-dashboard-bar-fill"
                      style={{ height: `${pct}%` }}
                      aria-hidden="true"
                    />
                  </div>
                  <span className="ghc-admin-dashboard-bar-label">{b.label}</span>
                  <span className="ghc-admin-dashboard-bar-count">{b.count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ghc-admin-dashboard-card">
          <h2 className="ghc-admin-dashboard-card-title">Recent activity</h2>
          {recentAudit.rows.length === 0 ? (
            <p className="ghc-admin-dashboard-empty">No recent activity yet.</p>
          ) : (
            <ul className="ghc-admin-dashboard-feed">
              {recentAudit.rows.map((row) => (
                <li key={row.id.toString()} className="ghc-admin-dashboard-feed-item">
                  <span className="ghc-admin-dashboard-feed-time">
                    {formatTime(row.createdAt, userTz)}
                  </span>
                  <AdminStatusChip variant="neutral">{row.action}</AdminStatusChip>
                  <span className="ghc-admin-dashboard-feed-actor">
                    {row.actorUserId
                      ? (actorEmails.get(row.actorUserId) ?? `#${row.actorUserId}`)
                      : 'system'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="ghc-admin-dashboard-card-link">
            <Link href="/admin/audit">View full audit log →</Link>
          </p>
        </div>
      </section>

      <section className="ghc-admin-github-volume-row mt-6">
        <div className="mb-3 flex items-baseline justify-between">
          <GithubRequestVolumeWindowSwitcher
            basePath="/admin"
            current={window}
          />
        </div>
        <GithubRequestVolumeChart data={githubVolume} tz={userTz} window={window} />
      </section>
    </div>
  );
}
