interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;

/**
 * Per-key in-memory token bucket. Fixed window of 60 seconds.
 * REPLACED in M8 by durable `lib/rate-limit/bucket.ts`. Do not extend
 * this module with new functionality — M8 will rewrite it.
 */
export function tokenBucket(key: string, perMinute: number): { allow(): boolean; reset(): void } {
  return {
    allow: () => {
      const now = Date.now();
      let current = buckets.get(key);
      if (!current || current.resetAt < now) {
        current = { count: 0, resetAt: now + WINDOW_MS };
        buckets.set(key, current);
      }
      if (current.count >= perMinute) return false;
      current.count++;
      return true;
    },
    reset: () => {
      buckets.delete(key);
    },
  };
}

// Test-only: clear all buckets. Not exported via index; tests import directly.
export function __resetAllBucketsForTests(): void {
  buckets.clear();
}