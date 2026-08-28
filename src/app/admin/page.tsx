import type { ReactElement } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db/client';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminKpiCard } from '@/app/admin/_components/admin-kpi-card';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { queryAuditLog, getActorEmails } from '@/lib/db/audit';

/**
 * Admin dashboard (M11.9 rewrite + M13.3 translation).
 *
 * Layout (top → bottom):
 *   1. AdminPageHeader — Dashboard + no actions (root of admin tree)
 *   2. 4 KPI cards: cached repos / active users / active api keys /
 *      active github tokens (with hint line)
 *   3. Two-column grid: requests-by-hour (last 6h, 1h buckets) + recent
 *      activity feed (top 5 audit entries)
 *
 * Data is fetched in parallel via Promise.all. The page is async SSR;
 * no client-side fetch needed.
 */
export default async function AdminDashboardPage(): Promise<ReactElement> {
  const t = await getTranslations('admin.shell.dashboard');

  const [repoCount, userCount, apiKeyCount, tokenCount, recentAudit] = await Promise.all([
    prisma.repository.count(),
    prisma.user.count({ where: { status: 'active' } }),
    prisma.apiKey.count({ where: { status: 'active' } }),
    prisma.githubToken.count({ where: { status: 'active' } }),
    queryAuditLog({ limit: 5, offset: 0 }),
  ]);

  // Requests by hour — last 6h, 1h buckets, sourced from audit log
  // (action = 'api.query' or 'cache.read'). Best-effort: counts are
  // a sampled view, not exact traffic accounting.
  const now = Date.now();
  const buckets = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(now - (6 - i) * 60 * 60 * 1000);
    const end = new Date(now - (5 - i) * 60 * 60 * 1000);
    return { start, end, label: t('chart.hoursAgo', { hours: String(6 - i) }), count: 0 };
  });
  const audit6h = await prisma.auditLog.findMany({
    where: { createdAt: { gte: new Date(now - 6 * 60 * 60 * 1000) } },
    select: { createdAt: true },
  });
  for (const row of audit6h) {
    const idx = buckets.findIndex(
      (b) => row.createdAt >= b.start && row.createdAt < b.end,
    );
    if (idx !== -1) buckets[idx]!.count += 1;
  }

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
          value={repoCount}
          hint={repoCount === 0 ? t('kpi.empty') : t('kpi.totalInCache')}
        />
        <AdminKpiCard
          label={t('kpi.activeUsers')}
          value={userCount}
          tone={userCount > 0 ? 'positive' : 'default'}
          hint={t('kpi.usersHint')}
        />
        <AdminKpiCard
          label={t('kpi.activeApiKeys')}
          value={apiKeyCount}
          tone={apiKeyCount > 0 ? 'positive' : 'default'}
          hint={t('kpi.apiKeysHint')}
        />
        <AdminKpiCard
          label={t('kpi.activeGithubTokens')}
          value={tokenCount}
          tone={tokenCount === 0 ? 'negative' : 'positive'}
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
                    {row.createdAt.toISOString().slice(11, 16)}
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
    </div>
  );
}
