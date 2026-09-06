import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email/sender';
import { buildDailyReport } from '@/lib/email/reports/build-daily';

/**
 * M25 — daily report cron tick.
 *
 * Runs every `EMAIL_DAILY_REPORT_INTERVAL_MS` (default 5min). Each tick
 * checks whether the current UTC minute is in the "00:00–00:04" window
 * — the only window in which we actually build + send the report. With
 * the default 5min cadence, that window gets evaluated once per day
 * (assuming the scheduler is up at midnight UTC). On off-nominal
 * deploys where the interval is 1min, the window catches the right
 * minute once per day.
 *
 * To prevent double-fires across multi-replica deploys, the cron
 * lock relies on EMAIL_DAILY_REPORT_INTERVAL_MS granularity — pick a
 * value that gives the scheduler only ONE chance to fire inside the
 * 5-minute UTC midnight window per day (5min does; 30min also does).
 *
 * Per the M25 contract:
 *   - Builds the report ONCE (cheap; cached by Prisma).
 *   - Sends to every active user with status='active' in parallel
 *     via Promise.allSettled — one SMTP failure does not poison the rest.
 *   - Logs a summary {recipients, sent, failed}.
 */
export async function runDailyReportTick(now: Date = new Date()): Promise<void> {
  // Skip unless we're in the 00:00..00:04 UTC window.
  if (!(now.getUTCHours() === 0 && now.getUTCMinutes() < 5)) {
    return;
  }

  const users = await prisma.user.findMany({
    where: { status: 'active' },
    select: { id: true, email: true },
  });

  if (users.length === 0) {
    logger.info('email_report_skipped no_active_users');
    return;
  }

  const report = await buildDailyReport(now);

  const results = await Promise.allSettled(
    users.map((u) =>
      sendEmail({
        to: u.email,
        subject: report.subject,
        html: report.html,
        text: report.text,
        templateKey: 'daily-report',
        relatedEntity: { type: 'user', id: u.id.toString() },
      }),
    ),
  );

  let sent = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.ok) sent++;
    else failed++;
  }

  logger.info(
    {
      recipients: users.length,
      sent,
      failed,
      kind: 'daily',
    },
    'email_report_sent',
  );
}
