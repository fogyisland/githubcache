import { writeAudit } from '@/lib/audit/writer';

export const LOGIN_THROTTLE_MAX_ATTEMPTS = 5;
export const LOGIN_THROTTLE_WINDOW_MS = 15 * 60 * 1000;

interface ThrottleEntry {
  attempts: number;
  resetAt: number; // epoch ms; counter resets when Date.now() >= resetAt
}

const throttles = new Map<string, ThrottleEntry>();

/**
 * Record a login attempt for the given IP. Returns whether the attempt is
 * allowed under the throttle limit (5 attempts per 15 minutes).
 *
 * On `allowed: false`, the attempt itself is NOT counted — the caller should
 * NOT proceed with credential validation (return 429 immediately).
 *
 * On `allowed: true`, the attempt IS counted. If the count reaches the max,
 * subsequent calls within the window return `allowed: false` with
 * `retryAfterSec` indicating seconds until the window resets.
 *
 * Side effect: when an attempt is blocked, writes an `audit_log` entry with
 * action `login_throttled`. (Successful/failed login attempts themselves are
 * audit-logged by the M6.4 route — this throttle audits its own block events.)
 */
export function recordLoginAttempt(
  ip: string,
): { allowed: boolean; attempts: number; retryAfterSec: number } {
  const now = Date.now();
  let entry = throttles.get(ip);
  if (!entry || entry.resetAt <= now) {
    // New window or expired
    entry = { attempts: 0, resetAt: now + LOGIN_THROTTLE_WINDOW_MS };
    throttles.set(ip, entry);
  }

  // Check if already blocked (within current window)
  if (entry.attempts >= LOGIN_THROTTLE_MAX_ATTEMPTS) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    // Audit-log the block (fire-and-forget — caller doesn't await this)
    void writeAudit({
      action: 'login_throttled',
      targetType: 'ip',
      targetId: ip,
      metadata: { attempts: entry.attempts, retryAfterSec },
      ip,
    });
    return { allowed: false, attempts: entry.attempts, retryAfterSec };
  }

  // Record this attempt
  entry.attempts++;
  return { allowed: true, attempts: entry.attempts, retryAfterSec: 0 };
}

/**
 * Reset the throttle counter for an IP. Call after a SUCCESSFUL login.
 *
 * Note: only resets if currently NOT in a blocked state — if the IP is still
 * within a blocked window, the reset does NOT grant immediate access (the
 * caller would need to retry after the window expires). This prevents a
 * "successful login right after 5th attempt" from bypassing the throttle.
 * Use `force: true` to reset unconditionally (e.g. admin override).
 */
export function resetLoginThrottle(ip: string, opts?: { force?: boolean }): void {
  if (!opts?.force) {
    const entry = throttles.get(ip);
    if (entry && entry.attempts >= LOGIN_THROTTLE_MAX_ATTEMPTS) {
      // Don't reset blocked state — must wait for window to expire
      return;
    }
  }
  throttles.delete(ip);
}

/**
 * Peek at the current throttle state for an IP without recording an attempt.
 * Used for diagnostics and tests.
 */
export function getLoginThrottleState(ip: string): { attempts: number; blockedUntil: Date | null } {
  const entry = throttles.get(ip);
  if (!entry) return { attempts: 0, blockedUntil: null };
  if (entry.resetAt <= Date.now()) return { attempts: 0, blockedUntil: null };
  const blockedUntil =
    entry.attempts >= LOGIN_THROTTLE_MAX_ATTEMPTS ? new Date(entry.resetAt) : null;
  return { attempts: entry.attempts, blockedUntil };
}

// Test-only: clear all throttle state. Not exported via index.
export function __resetAllLoginThrottlesForTests(): void {
  throttles.clear();
}
