/**
 * M14.6 — exponential backoff schedule for webhook delivery retries.
 * Attempts 1–5 (initial + 4 retries). After attempt 5 fails, the
 * delivery is marked `dead` and the subscription is auto-disabled.
 *
 * Backoff is wall-clock milliseconds from the failed attempt. The
 * constants are tuned for operator visibility: 1 minute catches most
 * transient blips quickly; 12 hours lets receivers come back online
 * after a multi-hour outage without losing events.
 *
 * Per-replica caveat: the retry timer is the `nextRetryAt` column on
 * each row. Multi-replica deployments see the same row pulled by any
 * replica (race documented in db.ts:claimDueDeliveries), so retries
 * may run earlier than scheduled if a peer picks the row up first.
 * Safe because delivery is idempotent at the receiver (verified by
 * the signature + replay of the same payload).
 */
export const MAX_ATTEMPTS = 5;
const BACKOFF_MS: readonly number[] = [
  60_000,        // attempt 1 → retry 1: 1 minute
  5 * 60_000,    // attempt 2 → retry 2: 5 minutes
  30 * 60_000,   // attempt 3 → retry 3: 30 minutes
  2 * 60 * 60_000,  // attempt 4 → retry 4: 2 hours
  12 * 60 * 60_000, // attempt 5 (which is the retry itself) → 12 hours — never used; max reached
];

/**
 * Returns the next retry time for a delivery that has just failed.
 * `attemptCount` is the count AFTER this failed attempt was recorded
 * (so attemptCount=1 means the initial delivery failed; we return
 * the time for attempt 2).
 *
 * If `attemptCount >= MAX_ATTEMPTS`, returns null — caller should
 * escalate to `dead` rather than schedule another retry.
 */
export function nextRetryMs(attemptCount: number): number | null {
  if (attemptCount >= MAX_ATTEMPTS) return null;
  const idx = attemptCount - 1; // attempts are 1-indexed
  return BACKOFF_MS[idx] ?? null;
}

/** True if the delivery should escalate to `dead` after the just-recorded
 *  failed attempt. */
export function shouldDeadLetter(attemptCount: number): boolean {
  return attemptCount >= MAX_ATTEMPTS;
}