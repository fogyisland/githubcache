import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordLoginAttempt,
  resetLoginThrottle,
  getLoginThrottleState,
  __resetAllLoginThrottlesForTests,
  LOGIN_THROTTLE_MAX_ATTEMPTS,
  LOGIN_THROTTLE_WINDOW_MS,
} from '@/lib/rate-limit/login-throttle';
import * as auditWriter from '@/lib/audit/writer';

const TEST_IP = '192.0.2.42'; // TEST-NET-1 reserved range — safe for tests

beforeEach(() => {
  __resetAllLoginThrottlesForTests();
});

describe('recordLoginAttempt', () => {
  it('first attempt is allowed with attempts=1', () => {
    const result = recordLoginAttempt(TEST_IP);
    expect(result.allowed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.retryAfterSec).toBe(0);
  });

  it('counts up to LOGIN_THROTTLE_MAX_ATTEMPTS, blocks the next', () => {
    for (let i = 1; i <= LOGIN_THROTTLE_MAX_ATTEMPTS; i++) {
      const r = recordLoginAttempt(TEST_IP);
      expect(r.allowed).toBe(true);
      expect(r.attempts).toBe(i);
    }
    const blocked = recordLoginAttempt(TEST_IP);
    expect(blocked.allowed).toBe(false);
    expect(blocked.attempts).toBe(LOGIN_THROTTLE_MAX_ATTEMPTS); // attempt that would exceed isn't counted
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(15 * 60);
  });

  it('blocked calls are NOT counted (do not extend retry)', () => {
    for (let i = 0; i < LOGIN_THROTTLE_MAX_ATTEMPTS; i++) {
      recordLoginAttempt(TEST_IP);
    }
    const before = recordLoginAttempt(TEST_IP); // blocked
    const retryAfterBefore = before.retryAfterSec;
    const after = recordLoginAttempt(TEST_IP); // blocked again
    expect(after.attempts).toBe(LOGIN_THROTTLE_MAX_ATTEMPTS); // unchanged
    // retryAfterSec should be approximately equal (within 1 sec)
    expect(Math.abs(after.retryAfterSec - retryAfterBefore)).toBeLessThanOrEqual(1);
  });

  it('different IPs have independent counters', () => {
    const ip1 = '192.0.2.1';
    const ip2 = '192.0.2.2';
    for (let i = 0; i < LOGIN_THROTTLE_MAX_ATTEMPTS; i++) {
      recordLoginAttempt(ip1);
    }
    const r1 = recordLoginAttempt(ip1); // blocked
    expect(r1.allowed).toBe(false);
    const r2 = recordLoginAttempt(ip2);
    expect(r2.allowed).toBe(true);
    expect(r2.attempts).toBe(1);
  });

  it('window resets after LOGIN_THROTTLE_WINDOW_MS (simulated via fake timers)', async () => {
    const vi = await import('vitest');
    vi.vi.useFakeTimers();
    vi.vi.setSystemTime(new Date('2026-08-16T12:00:00Z'));
    for (let i = 0; i < LOGIN_THROTTLE_MAX_ATTEMPTS; i++) {
      recordLoginAttempt(TEST_IP);
    }
    expect(recordLoginAttempt(TEST_IP).allowed).toBe(false);
    // Advance past the window
    vi.vi.setSystemTime(new Date(Date.now() + LOGIN_THROTTLE_WINDOW_MS + 1000));
    const after = recordLoginAttempt(TEST_IP);
    expect(after.allowed).toBe(true);
    expect(after.attempts).toBe(1); // new window
    vi.vi.useRealTimers();
  });

  it('writes audit_log on block (action=login_throttled)', async () => {
    // Mock writeAudit to avoid the in-process race with fire-and-forget DB
    // writes from prior tests. We assert on the call itself, not on the DB.
    const writeAuditSpy = vi.spyOn(auditWriter, 'writeAudit').mockResolvedValue({} as any);
    try {
      for (let i = 0; i < LOGIN_THROTTLE_MAX_ATTEMPTS; i++) {
        recordLoginAttempt(TEST_IP);
      }
      recordLoginAttempt(TEST_IP); // blocks → triggers audit write
      // The throttle fires writeAudit via `void writeAudit(...)` — flush microtasks
      await vi.waitFor(() => expect(writeAuditSpy).toHaveBeenCalledTimes(1));
      expect(writeAuditSpy).toHaveBeenCalledWith({
        action: 'login_throttled',
        targetType: 'ip',
        targetId: TEST_IP,
        metadata: expect.objectContaining({
          attempts: LOGIN_THROTTLE_MAX_ATTEMPTS,
          retryAfterSec: expect.any(Number) as number,
        }),
        ip: TEST_IP,
      });
    } finally {
      writeAuditSpy.mockRestore();
    }
  });
});

describe('resetLoginThrottle', () => {
  it('clears counter for successful login (below threshold)', () => {
    recordLoginAttempt(TEST_IP);
    recordLoginAttempt(TEST_IP);
    resetLoginThrottle(TEST_IP);
    const after = recordLoginAttempt(TEST_IP);
    expect(after.attempts).toBe(1);
    expect(after.allowed).toBe(true);
  });

  it('does NOT reset a blocked IP (preserves window)', () => {
    for (let i = 0; i < LOGIN_THROTTLE_MAX_ATTEMPTS; i++) {
      recordLoginAttempt(TEST_IP);
    }
    recordLoginAttempt(TEST_IP); // blocked
    resetLoginThrottle(TEST_IP);
    const after = recordLoginAttempt(TEST_IP);
    expect(after.allowed).toBe(false);
    expect(after.attempts).toBe(LOGIN_THROTTLE_MAX_ATTEMPTS);
  });

  it('force=true resets even when blocked', () => {
    for (let i = 0; i < LOGIN_THROTTLE_MAX_ATTEMPTS; i++) {
      recordLoginAttempt(TEST_IP);
    }
    recordLoginAttempt(TEST_IP); // blocked
    resetLoginThrottle(TEST_IP, { force: true });
    const after = recordLoginAttempt(TEST_IP);
    expect(after.attempts).toBe(1);
    expect(after.allowed).toBe(true);
  });

  it('no-op for IP with no history', () => {
    expect(() => resetLoginThrottle('192.0.2.99')).not.toThrow();
  });
});

describe('getLoginThrottleState', () => {
  it('returns attempts=0, blockedUntil=null for new IP', () => {
    const state = getLoginThrottleState(TEST_IP);
    expect(state.attempts).toBe(0);
    expect(state.blockedUntil).toBeNull();
  });

  it('returns current attempts and blockedUntil when blocked', () => {
    for (let i = 0; i < LOGIN_THROTTLE_MAX_ATTEMPTS; i++) {
      recordLoginAttempt(TEST_IP);
    }
    recordLoginAttempt(TEST_IP); // triggers block
    const state = getLoginThrottleState(TEST_IP);
    expect(state.attempts).toBe(LOGIN_THROTTLE_MAX_ATTEMPTS);
    expect(state.blockedUntil).toBeInstanceOf(Date);
    const expectedResetAt = Date.now() + LOGIN_THROTTLE_WINDOW_MS;
    expect(state.blockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(state.blockedUntil!.getTime()).toBeLessThanOrEqual(expectedResetAt + 1000);
  });

  it('does not record an attempt (peek only)', () => {
    recordLoginAttempt(TEST_IP);
    const before = getLoginThrottleState(TEST_IP);
    getLoginThrottleState(TEST_IP);
    getLoginThrottleState(TEST_IP);
    const after = getLoginThrottleState(TEST_IP);
    expect(after.attempts).toBe(before.attempts);
  });
});
