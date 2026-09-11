import { prisma } from '@/lib/db/client';

export interface DashboardBucket {
  start: Date;
  end: Date;
  label: string;
  count: number;
}

/**
 * Build the 6-hour requests-by-hour buckets for the admin dashboard chart
 * and count audit-log entries that fell into each bucket.
 *
 * Lifted out of `src/app/admin/page.tsx` because `react-hooks/purity`
 * flags `Date.now()` calls inside the function-component body. This is
 * a plain helper (no JSX, not PascalCase), so the rule does not apply.
 *
 * `formatHoursAgoLabel` is injected so the caller controls the i18n
 * label format (must come from `getTranslations` — this helper is
 * not allowed to call `next-intl/server` itself without becoming a
 * server component).
 */
export async function loadDashboardBuckets(
  formatHoursAgoLabel: (hours: number) => string,
): Promise<DashboardBucket[]> {
  const now = Date.now();
  const buckets: DashboardBucket[] = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(now - (6 - i) * 60 * 60 * 1000);
    const end = new Date(now - (5 - i) * 60 * 60 * 1000);
    return { start, end, label: formatHoursAgoLabel(6 - i), count: 0 };
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
  return buckets;
}

/**
 * M30 — single-roundtrip aggregate for the 4 dashboard KPI tiles.
 *
 * Replaces the 4 parallel `prisma.X.count()` calls the dashboard
 * used to make. One `$queryRaw` round-trip returns all four counts
 * (cached repos, active users, active API keys, active GitHub
 * tokens); the sub-selects let MySQL use the existing indexes on
 * `status`.
 *
 * `prisma.$queryRaw` returns the count columns as `bigint`. We
 * `Number(...)` them at the boundary so JSX can render them
 * directly — Prisma's bigint does not serialize cleanly to React
 * text nodes without an explicit conversion.
 */
export interface DashboardCounts {
  cachedRepos: number;
  activeUsers: number;
  activeApiKeys: number;
  activeGithubTokens: number;
}

interface DashboardCountsRow {
  cached_repos: bigint;
  active_users: bigint;
  active_api_keys: bigint;
  active_github_tokens: bigint;
}

export async function getDashboardCounts(): Promise<DashboardCounts> {
  const rows = await prisma.$queryRaw<DashboardCountsRow[]>`
    SELECT
      (SELECT COUNT(*) FROM repositories) AS cached_repos,
      (SELECT COUNT(*) FROM users WHERE status = 'active') AS active_users,
      (SELECT COUNT(*) FROM api_keys WHERE status = 'active') AS active_api_keys,
      (SELECT COUNT(*) FROM github_tokens WHERE status = 'active') AS active_github_tokens
  `;
  const r = rows[0]!;
  return {
    cachedRepos: Number(r.cached_repos),
    activeUsers: Number(r.active_users),
    activeApiKeys: Number(r.active_api_keys),
    activeGithubTokens: Number(r.active_github_tokens),
  };
}