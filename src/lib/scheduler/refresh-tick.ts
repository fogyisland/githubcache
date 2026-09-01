import { logger } from '@/lib/logger';
import { env } from '@/lib/config/env';
import { isPaused } from './state';

/**
 * M22.2 — refresh-tick interval ownership lives in its own module so the
 * scheduler can fully clearInterval during a rate-limit auto-pause without
 * pulling `runTick` (and its full import graph, including the heavyweight
 * webhooks/worker.ts) into every module that needs to know whether the tick
 * is paused.
 *
 * Wire-up:
 *  - `src/lib/scheduler/index.ts` calls `setRefreshTickFn(runTick)` at boot
 *    to inject the runTick reference, then `resumeRefreshTick()` to start.
 *  - `src/lib/scheduler/tick.ts` calls `pauseRefreshTick()` / `resumeRefreshTick()`
 *    from its auto-pause + auto-resume branches.
 *
 * Why a separate file: a top-level `import { runTick } from './tick'` in
 * the interval-owning module would create a circular dependency with
 * `tick.ts` (which imports the pause/resume helpers from this file).
 * Splitting the ownership lets both files import from this file in one
 * direction without a cycle.
 */

type RefreshTickFn = () => Promise<unknown>;

let tickFn: RefreshTickFn | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Inject the function the refresh-tick interval should call on each fire.
 * Called once at boot by `startScheduler()`. Idempotent.
 */
export function setRefreshTickFn(fn: RefreshTickFn): void {
  tickFn = fn;
}

/**
 * Stop the refresh-tick interval. Safe to call when no interval is running.
 *
 * M22 — used by `runTick()` when all GitHub tokens are exhausted so the
 * scheduler goes fully quiet (no 1Hz setInterval callbacks) until the rate-
 * limit window resets. The sweep + webhook intervals are NOT touched.
 */
export function pauseRefreshTick(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
    logger.info('refresh tick interval paused');
  }
}

/**
 * Restart the refresh-tick interval. No-op if already running or if no tick
 * function has been registered.
 *
 * M22 — called by `runTick()` when tokens become available again after an
 * auto-pause, and by the `setTimeout` callback in `scheduleAutoResume()`
 * when the rate-limit window resets.
 */
export function resumeRefreshTick(): void {
  if (tickInterval) return; // already running
  if (!tickFn) {
    logger.warn('resumeRefreshTick called before setRefreshTickFn; ignoring');
    return;
  }
  const fn = tickFn;
  tickInterval = setInterval(() => {
    // Defense-in-depth: if `pause()` flipped the flag between setInterval
    // fires, skip the tick without doing any work. The M22 auto-pause path
    // also calls pauseRefreshTick() to fully clearInterval, so this branch
    // is only hit if pause() was called without the matching pauseRefreshTick().
    if (isPaused()) return;
    fn().catch((e: unknown) => {
      logger.error({ err: e }, 'refresh tick handler failed');
    });
  }, env.SCHEDULER_TICK_MS);
  tickInterval.unref?.();
  logger.info({ tickMs: env.SCHEDULER_TICK_MS }, 'refresh tick interval resumed');
}
