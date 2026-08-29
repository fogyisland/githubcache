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