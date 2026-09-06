import { logger } from '@/lib/logger';
import { env } from '@/lib/config/env';
import { runTick } from './tick';
import { nightlySweep } from './sweep';
import { runWorkerTick } from '@/lib/webhooks/worker';
import { runDailyReportTick } from './cron-daily-report';
import { runWeeklyReportTick } from './cron-weekly-report';
import {
  pauseRefreshTick,
  resumeRefreshTick,
  setRefreshTickFn,
} from './refresh-tick';

// Re-export pause/resume state helpers. Defined in `./state` to avoid a
// circular import with `./tick` (which imports `isPaused`).
export { pause, resume, isPaused, getPausedAt } from './state';

// Re-export refresh-tick interval controls so existing call sites
// (`runTick` in `./tick` and admin pages) can import from `@/lib/scheduler`.
// Internally they live in `./refresh-tick` to break a circular dep.
export { pauseRefreshTick, resumeRefreshTick } from './refresh-tick';

interface SchedulerHandle {
  stop(): void;
}

let activeHandle: SchedulerHandle | null = null;

/**
 * Start the in-process scheduler. Sets up three intervals:
 *  - tick: every SCHEDULER_TICK_MS (default 60s) — drain the refresh_jobs queue
 *  - sweep: every NIGHTLY_SWEEP_INTERVAL_MS (default 24h) — re-enqueue all ok repos
 *  - webhook worker: every WEBHOOK_WORKER_TICK_MS (default 15s) — deliver due webhooks
 *
 * Returns a handle with `stop()` to halt all intervals. Production wiring
 * (SIGTERM/SIGINT → stop()) is in src/server.ts (M5.6).
 *
 * If SCHEDULER_ENABLED=false, this is a no-op and returns a noop handle.
 *
 * Singleton: calling startScheduler twice without stopping returns the same
 * handle (the second call is a no-op, logs a warning).
 *
 * Test setup: set SCHEDULER_ENABLED=false (and override tick interval to a
 * large value) to prevent the scheduler from actually starting during tests.
 * Use vi.stubEnv('SCHEDULER_ENABLED', 'false') in test setup.
 */
export function startScheduler(): SchedulerHandle {
  if (activeHandle) {
    logger.warn('scheduler already started; returning existing handle');
    return activeHandle;
  }

  if (!env.SCHEDULER_ENABLED) {
    logger.info('scheduler disabled via SCHEDULER_ENABLED=false');
    activeHandle = { stop: () => { /* noop */ } };
    return activeHandle;
  }

  // M22.2 — the refresh-tick interval lives in `./refresh-tick` so it can be
  // fully clearInterval'd during rate-limit auto-pause. Inject the runTick
  // reference and start the interval.
  setRefreshTickFn(runTick);
  resumeRefreshTick();

  const sweepInterval = setInterval(() => {
    nightlySweep().catch((e: unknown) => {
      logger.error({ err: e }, 'nightlySweep failed');
    });
  }, env.NIGHTLY_SWEEP_INTERVAL_MS);

  // M14.6 — webhook delivery worker. Runs alongside the refresh tick on
  // its own cadence (default 15s — faster than refresh because deliveries
  // can be queued at any moment via the audit-write hook). Processes up to
  // BATCH_SIZE due deliveries per tick serially.
  const webhookWorkerInterval = setInterval(() => {
    runWorkerTick(env.WEBHOOK_WORKER_BATCH_SIZE).catch((e: unknown) => {
      logger.error({ err: e }, 'webhook runWorkerTick failed');
    });
  }, env.WEBHOOK_WORKER_TICK_MS);

  // M25 — daily report cron. The default 5-minute cadence ensures the
  // 00:00–00:04 UTC window fires exactly once per day (in normal ops).
  const dailyReportInterval = setInterval(() => {
    runDailyReportTick().catch((e: unknown) => {
      logger.error({ err: e }, 'daily report tick failed');
    });
  }, env.EMAIL_DAILY_REPORT_INTERVAL_MS);
  dailyReportInterval.unref?.();

  // M25 — weekly report cron (Monday 00:10 UTC). The default 60-min
  // cadence still hits the 5-min window once per week.
  const weeklyReportInterval = setInterval(() => {
    runWeeklyReportTick().catch((e: unknown) => {
      logger.error({ err: e }, 'weekly report tick failed');
    });
  }, env.EMAIL_WEEKLY_REPORT_INTERVAL_MS);
  weeklyReportInterval.unref?.();

  // Don't keep the process alive solely for these timers (in case Next.js exits)
  sweepInterval.unref?.();
  webhookWorkerInterval.unref?.();

  logger.info(
    {
      tickMs: env.SCHEDULER_TICK_MS,
      sweepMs: env.NIGHTLY_SWEEP_INTERVAL_MS,
      webhookWorkerMs: env.WEBHOOK_WORKER_TICK_MS,
      webhookWorkerBatch: env.WEBHOOK_WORKER_BATCH_SIZE,
      dailyReportMs: env.EMAIL_DAILY_REPORT_INTERVAL_MS,
      weeklyReportMs: env.EMAIL_WEEKLY_REPORT_INTERVAL_MS,
    },
    'scheduler started',
  );

  activeHandle = {
    stop: () => {
      pauseRefreshTick();
      clearInterval(sweepInterval);
      clearInterval(webhookWorkerInterval);
      clearInterval(dailyReportInterval);
      clearInterval(weeklyReportInterval);
      activeHandle = null;
      logger.info('scheduler stopped');
    },
  };
  return activeHandle;
}

/** Test helper — stops the singleton if started. */
export function stopScheduler(): void {
  activeHandle?.stop();
}
