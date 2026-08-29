import { describe, it, expect } from 'vitest';
import { MAX_ATTEMPTS, nextRetryMs, shouldDeadLetter } from '@/lib/webhooks/retry';

describe('webhook retry schedule', () => {
  it('caps at MAX_ATTEMPTS = 5', () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });

  describe('nextRetryMs', () => {
    it('returns 60_000 ms after the first failure (attemptCount=1)', () => {
      expect(nextRetryMs(1)).toBe(60_000);
    });

    it('returns 5 minutes after the second failure', () => {
      expect(nextRetryMs(2)).toBe(5 * 60_000);
    });

    it('returns 30 minutes after the third failure', () => {
      expect(nextRetryMs(3)).toBe(30 * 60_000);
    });

    it('returns 2 hours after the fourth failure', () => {
      expect(nextRetryMs(4)).toBe(2 * 60 * 60_000);
    });

    it('returns null at MAX_ATTEMPTS (caller should dead-letter)', () => {
      expect(nextRetryMs(MAX_ATTEMPTS)).toBeNull();
    });

    it('returns null for any attemptCount beyond MAX_ATTEMPTS', () => {
      expect(nextRetryMs(MAX_ATTEMPTS + 1)).toBeNull();
      expect(nextRetryMs(99)).toBeNull();
    });
  });

  describe('shouldDeadLetter', () => {
    it('is false while attemptCount is below MAX_ATTEMPTS', () => {
      expect(shouldDeadLetter(1)).toBe(false);
      expect(shouldDeadLetter(MAX_ATTEMPTS - 1)).toBe(false);
    });

    it('is true when attemptCount reaches MAX_ATTEMPTS', () => {
      expect(shouldDeadLetter(MAX_ATTEMPTS)).toBe(true);
    });

    it('is true beyond MAX_ATTEMPTS', () => {
      expect(shouldDeadLetter(MAX_ATTEMPTS + 1)).toBe(true);
    });
  });
});