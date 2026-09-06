import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email/sender';
import { buildWeeklyReport } from '@/lib/email/reports/build-weekly';

/**
 * M25 — weekly report cron tick.
 *
 * Fires only in the Monday 00:10–00:14 UTC window. The 10-minute
 * offset from the daily cron prevents both timers from running
 * concurrently in the same minute (parallel DB load is fine, but
 * we'd rather not pile on for log-noise reasons).
 *
 * Sends to every active user; Promise.allSettled isolates per-user
 * SMTP failures.
 */
export async function runWeeklyReportTick(now: Date = new Date()): Promise<void> {
  // Skip unless we're Monday in the 00:10..00:14 UTC window.
  // getUTCDay(): 0=Sun, 1=Mon, …, 6=Sat
  const isMonday = now.getUTCDay() === 1;
  const inWindow = now.getUTCHours() === 0 && now.getUTCMinutes() >= 10 && now.getUTCMinutes() < 15;
  if (!(isMonday && inWindow)) {
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

  const report = await buildWeeklyReport(now);

  const results = await Promise.allSettled(
    users.map((u) =>
      sendEmail({
        to: u.email,
        subject: report.subject,
        html: report.html,
        text: report.text,
        templateKey: 'weekly-report',
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
      kind: 'weekly',
    },
    'email_report_sent',
  );
}
