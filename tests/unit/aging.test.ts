import { describe, it, expect } from 'vitest';
import { nextDelay } from '@/lib/scheduler/aging';

const ONE_HOUR = 60 * 60_000;
const SIX_HOURS = 6 * ONE_HOUR;
const SEVEN_DAYS = 7 * 24 * ONE_HOUR;
const FIVE_MIN = 5 * 60_000;
const FIFTEEN_MIN = 15 * 60_000;
const TWENTY_FOUR_HOURS = 24 * ONE_HOUR;

describe('nextDelay — success mode', () => {
  it('returns 1h when refreshCount is 0', () => {
    expect(nextDelay(0, 0)).toEqual({ ms: ONE_HOUR });
  });

  it('returns 6h when refreshCount is 1', () => {
    expect(nextDelay(1, 0)).toEqual({ ms: SIX_HOURS });
  });

  it('returns 7d when refreshCount is 2', () => {
    expect(nextDelay(2, 0)).toEqual({ ms: SEVEN_DAYS });
  });

  it('returns 7d when refreshCount is >= 2 (steady state)', () => {
    expect(nextDelay(3, 0)).toEqual({ ms: SEVEN_DAYS });
    expect(nextDelay(10, 0)).toEqual({ ms: SEVEN_DAYS });
    expect(nextDelay(1000, 0)).toEqual({ ms: SEVEN_DAYS });
  });

  it('hot-bump: returns 1h when recentQueryCount24h > 10, regardless of refreshCount', () => {
    expect(nextDelay(0, 11)).toEqual({ ms: ONE_HOUR });
    expect(nextDelay(1, 11)).toEqual({ ms: ONE_HOUR });
    expect(nextDelay(2, 11)).toEqual({ ms: ONE_HOUR });
    expect(nextDelay(100, 100)).toEqual({ ms: ONE_HOUR });
  });

  it('hot-bump threshold: recentQueryCount24h === 10 does NOT trigger hot-bump', () => {
    // Strictly greater than 10, per spec wording
    expect(nextDelay(2, 10)).toEqual({ ms: SEVEN_DAYS });
  });

  it('recentQueryCount24h === 0 does NOT trigger hot-bump', () => {
    expect(nextDelay(2, 0)).toEqual({ ms: SEVEN_DAYS });
  });

  it('never sets failure flag in success mode', () => {
    expect(nextDelay(0, 0).failure).toBeUndefined();
    expect(nextDelay(2, 100).failure).toBeUndefined();
    // Negative recentQueryCount24h sentinel switches to failure mode, so the last assertion is wrong.
    // Test for failure flag ABSENCE only with non-negative recentQueryCount24h.
    expect(nextDelay(0, -0).failure).toBeUndefined(); // -0 is 0, not negative
  });
});

describe('nextDelay — failure mode (recentQueryCount24h < 0 sentinel)', () => {
  it('attempts === 1 → 5 minutes', () => {
    expect(nextDelay(1, -1)).toEqual({ ms: FIVE_MIN });
  });

  it('attempts === 2 → 15 minutes', () => {
    expect(nextDelay(2, -1)).toEqual({ ms: FIFTEEN_MIN });
  });

  it('attempts === 3 → 1 hour', () => {
    expect(nextDelay(3, -1)).toEqual({ ms: ONE_HOUR });
  });

  it('attempts === 4 → 6 hours', () => {
    expect(nextDelay(4, -1)).toEqual({ ms: SIX_HOURS });
  });

  it('attempts === 5 → 24 hours AND failure flag', () => {
    expect(nextDelay(5, -1)).toEqual({ ms: TWENTY_FOUR_HOURS, failure: true });
  });

  it('attempts > 5 → 24 hours AND failure flag (escalation persists)', () => {
    expect(nextDelay(6, -1)).toEqual({ ms: TWENTY_FOUR_HOURS, failure: true });
    expect(nextDelay(100, -1)).toEqual({ ms: TWENTY_FOUR_HOURS, failure: true });
  });

  it('any negative recentQueryCount24h triggers failure mode', () => {
    expect(nextDelay(1, -1).ms).toBe(FIVE_MIN);
    expect(nextDelay(1, -100).ms).toBe(FIVE_MIN);
    expect(nextDelay(5, -0.001).failure).toBe(true);
  });
});

describe('nextDelay — edge cases', () => {
  it('attempts === 0 in failure mode is defensive (returns 5min)', () => {
    // Defensive: caller should never pass 0, but if it does, no crash
    expect(nextDelay(0, -1).ms).toBe(FIVE_MIN);
  });

  it('negative refreshCount in success mode treats as 0 (1h)', () => {
    // Defensive: caller should never pass negative, but no crash
    expect(nextDelay(-1, 0).ms).toBe(ONE_HOUR);
  });

  it('returns plain object (not class instance)', () => {
    const result = nextDelay(0, 0);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});
