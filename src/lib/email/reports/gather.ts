import { prisma } from '@/lib/db/client';
import { totalRequests, cacheHitRate, avgLatency, topRepos } from '@/lib/reports/queries';

/**
 * M25 — data gatherers for daily + weekly reports.
 *
 * The split exists so callers (cron tick, preview endpoint, future admin
 * "send preview now" button) can hit `gather*` to inspect the data
 * without rendering the email template.
 *
 * Windows are UTC and aligned to midnight:
 *   daily:  [yesterday 00:00, today 00:00)
 *   weekly: [7 days ago at 00:00, today 00:00)
 */

export interface TokenQuotaSnapshot {
  label: string;
  requestsUsed: number;
  requestsLimit: number;
}

export interface DailyReportData {
  dateLabel: string;
  windowStartUtc: string;
  windowEndUtc: string;
  totalRequests: number;
  cacheHitRate: number;
  avgLatencyMs: number;
  failedJobs24h: number;
  topRepos: Array<{ repo: string; requestCount: number; hitRate: number }>;
  tokenQuotaUsage: TokenQuotaSnapshot[];
}

export interface WeeklyReportData {
  dateLabel: string;
  windowStartUtc: string;
  windowEndUtc: string;
  totalRequests: number;
  cacheHitRate: number;
  avgLatencyMs: number;
  failed7d: number;
  topRepos: Array<{ repo: string; requestCount: number; hitRate: number }>;
}

/** Compute the [yesterday 00:00 UTC, today 00:00 UTC) window. */
function dailyWindow(now: Date): { from: Date; to: Date } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return { from, to };
}

/** Compute the [7 days ago at 00:00 UTC, today 00:00 UTC) window. */
function weeklyWindow(now: Date): { from: Date; to: Date } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from, to };
}

function fmtIso(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function gatherDailyReportData(now: Date): Promise<DailyReportData> {
  const { from, to } = dailyWindow(now);
  const [total, hit, avg, top, tokens, failed24h] = await Promise.all([
    totalRequests(from, to),
    cacheHitRate(from, to),
    avgLatency(from, to),
    topRepos(from, to, 5),
    prisma.githubToken.findMany({
      select: { label: true, requestsUsed: true, requestsLimit: true },
    }),
    prisma.refreshJob.count({
      where: { status: 'failed', updatedAt: { gte: from, lt: to } },
    }),
  ]);
  return {
    dateLabel: fmtDate(from),
    windowStartUtc: fmtIso(from),
    windowEndUtc: fmtIso(to),
    totalRequests: total,
    cacheHitRate: hit,
    avgLatencyMs: avg,
    failedJobs24h: failed24h,
    topRepos: top,
    tokenQuotaUsage: tokens.map((t) => ({
      label: t.label,
      requestsUsed: t.requestsUsed,
      requestsLimit: t.requestsLimit,
    })),
  };
}

export async function gatherWeeklyReportData(now: Date): Promise<WeeklyReportData> {
  const { from, to } = weeklyWindow(now);
  const [total, hit, avg, top, failed7d] = await Promise.all([
    totalRequests(from, to),
    cacheHitRate(from, to),
    avgLatency(from, to),
    topRepos(from, to, 10),
    prisma.refreshJob.count({
      where: { status: 'failed', updatedAt: { gte: from, lt: to } },
    }),
  ]);
  return {
    dateLabel: fmtDate(new Date(to.getTime() - 24 * 60 * 60 * 1000)),
    windowStartUtc: fmtIso(from),
    windowEndUtc: fmtIso(to),
    totalRequests: total,
    cacheHitRate: hit,
    avgLatencyMs: avg,
    failed7d,
    topRepos: top,
  };
}
