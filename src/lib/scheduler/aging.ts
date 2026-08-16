/**
 * Computes the delay until the next refresh job should run.
 *
 * Two modes, distinguished by `recentQueryCount24h`:
 *
 * **Success mode** (recentQueryCount24h >= 0):
 *   - If recentQueryCount24h > 10 → 1 hour (hot-bump override)
 *   - Else if refreshCount === 0   → 1 hour
 *   - Else if refreshCount === 1   → 6 hours
 *   - Else (refreshCount >= 2)     → 7 days
 *
 * **Failure mode** (recentQueryCount24h < 0, sentinel):
 *   Reads `refreshCount` as `attempts` (number of consecutive failures):
 *   - attempts === 1 → 5 minutes
 *   - attempts === 2 → 15 minutes
 *   - attempts === 3 → 1 hour
 *   - attempts === 4 → 6 hours
 *   - attempts >= 5  → 24 hours AND `{ failure: true }` flag returned
 *     (caller escalates: writes to audit_log, flags repo for admin review)
 *
 * @param refreshCount       Success mode: total successful refreshes for this repo (including the one just completed).
 *                           Failure mode: number of consecutive failures (>= 1).
 * @param recentQueryCount24h Success mode: count of /api/query requests for this repo in the last 24h (from request_log).
 *                            Failure mode: pass any negative number as a sentinel.
 * @returns                  `{ ms, failure? }`. `failure: true` is set ONLY when attempts >= 5 in failure mode.
 */
export function nextDelay(
  refreshCount: number,
  recentQueryCount24h: number,
): { ms: number; failure?: boolean } {
  if (recentQueryCount24h < 0) {
    return failureDelay(refreshCount);
  }
  return successDelay(refreshCount, recentQueryCount24h);
}

function successDelay(refreshCount: number, recentQueryCount24h: number): { ms: number } {
  if (recentQueryCount24h > 10) {
    return { ms: ONE_HOUR_MS };
  }
  // Treat negative refreshCount as 0 (defensive: caller should never pass negative)
  const count = refreshCount < 0 ? 0 : refreshCount;
  if (count === 0) return { ms: ONE_HOUR_MS };
  if (count === 1) return { ms: SIX_HOURS_MS };
  return { ms: SEVEN_DAYS_MS };
}

function failureDelay(attempts: number): { ms: number; failure?: boolean } {
  if (attempts <= 0) return { ms: FIVE_MIN_MS }; // defensive: 0 attempts shouldn't happen
  if (attempts === 1) return { ms: FIVE_MIN_MS };
  if (attempts === 2) return { ms: FIFTEEN_MIN_MS };
  if (attempts === 3) return { ms: ONE_HOUR_MS };
  if (attempts === 4) return { ms: SIX_HOURS_MS };
  return { ms: TWENTY_FOUR_HOURS_MS, failure: true };
}

const FIVE_MIN_MS = 5 * 60_000;
const FIFTEEN_MIN_MS = 15 * 60_000;
const ONE_HOUR_MS = 60 * 60_000;
const SIX_HOURS_MS = 6 * 60 * 60_000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60_000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000;
