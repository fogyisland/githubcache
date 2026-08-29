import { logger } from '@/lib/logger';
import { env } from '@/lib/config/env';
import { runTick } from './tick';
import { nightlySweep } from './sweep';
import { runWorkerTick } from '@/lib/webhooks/worker';

// Re-export pause/resume state helpers. Defined in `./state` to avoid a
// circular import with `./tick` (which imports `isPaused`).
export { pause, resume, isPaused, getPausedAt } from './state';

interface SchedulerHandle {
  stop(): void;
}

let activeHandle: SchedulerHandle | null = null;

/**
 * Start the in-process scheduler. Sets up two intervals:
 *  - tick: every SCHEDULER_TICK_MS (default 60s) — drain the refresh_jobs queue
 *  - sweep: every NIGHTLY_SWEEP_INTERVAL_MS (default 24h) — re-enqueue all ok repos
 *
 * Returns a handle with `stop()` to halt both intervals. Production wiring
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

  const tickInterval = setInterval(() => {
    runTick().catch((e: unknown) => {
      logger.error({ err: e }, 'runTick failed');
    });
  }, env.SCHEDULER_TICK_MS);

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

  // Don't keep the process alive solely for these timers (in case Next.js exits)
  tickInterval.unref?.();
  sweepInterval.unref?.();
  webhookWorkerInterval.unref?.();

  logger.info(
    {
      tickMs: env.SCHEDULER_TICK_MS,
      sweepMs: env.NIGHTLY_SWEEP_INTERVAL_MS,
      webhookWorkerMs: env.WEBHOOK_WORKER_TICK_MS,
      webhookWorkerBatch: env.WEBHOOK_WORKER_BATCH_SIZE,
    },
    'scheduler started',
  );

  activeHandle = {
    stop: () => {
      clearInterval(tickInterval);
      clearInterval(sweepInterval);
      clearInterval(webhookWorkerInterval);
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
