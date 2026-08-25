// Process-local pause flag for the in-process scheduler (M7.6).
//
// Why process-local (not DB-backed):
//   - The scheduler is single-worker (M5.5 ruling). Pause affects THIS process.
//   - DB-backed pause would require the scheduler tick to query DB every
//     interval, adding latency.
//   - Multi-process deployments are out of scope per M5.5.
//
// Caveat: if the admin UI is connected to process B but the scheduler runs
// in process A, the toggle won't take effect until process A's tick reads
// the flag. The /admin/refresh page documents this limitation.

let pausedFlag = false;
let pausedAt: Date | null = null;

/**
 * Pause the scheduler (process-local). Pending jobs stay in the queue;
 * the next `runTick` will check `isPaused()` and early-return without
 * claiming or processing them. Use `resume()` to re-enable.
 *
 * Idempotent: calling `pause()` when already paused is a no-op (does NOT
 * update the `pausedAt` timestamp).
 *
 * Note: process-local flag — only affects THIS process. Multi-process
 * deployments would need a DB-backed pause flag (out of scope per M5.5).
 */
export function pause(): void {
  if (pausedFlag) return;
  pausedFlag = true;
  pausedAt = new Date();
}

/**
 * Resume the scheduler. Idempotent: calling `resume()` when not paused is
 * a no-op. Clears the `pausedAt` timestamp.
 */
export function resume(): void {
  if (!pausedFlag) return;
  pausedFlag = false;
  pausedAt = null;
}

/** Returns true if the scheduler is currently paused (in this process). */
export function isPaused(): boolean {
  return pausedFlag;
}

/** Timestamp when the scheduler was most recently paused, or null. */
export function getPausedAt(): Date | null {
  return pausedAt;
}
