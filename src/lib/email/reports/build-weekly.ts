import { gatherWeeklyReportData } from '@/lib/email/reports/gather';
import { weeklyReportTemplate } from '@/lib/email/templates/weekly-report';
import type { WeeklyReportData } from '@/lib/email/reports/gather';

export interface BuiltWeeklyReport {
  subject: string;
  html: string;
  text: string;
  data: WeeklyReportData;
}

export async function buildWeeklyReport(now: Date): Promise<BuiltWeeklyReport> {
  const data = await gatherWeeklyReportData(now);
  const t = weeklyReportTemplate({ data });
  return { ...t, data };
}
