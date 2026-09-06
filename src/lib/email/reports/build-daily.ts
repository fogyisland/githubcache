import { gatherDailyReportData } from '@/lib/email/reports/gather';
import { dailyReportTemplate } from '@/lib/email/templates/daily-report';
import type { DailyReportData } from '@/lib/email/reports/gather';

export interface BuiltReport {
  subject: string;
  html: string;
  text: string;
  data: DailyReportData;
}

/**
 * M25 — top-level daily report builder. Gathers data and renders the
 * template in one call so cron ticks don't need to coordinate two steps.
 */
export async function buildDailyReport(now: Date): Promise<BuiltReport> {
  const data = await gatherDailyReportData(now);
  const t = dailyReportTemplate({ data });
  return { ...t, data };
}
