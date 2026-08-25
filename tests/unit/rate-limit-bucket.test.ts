import { describe, it, expect } from 'vitest';
import { windowStartFor, retryAfterSeconds } from '@/lib/db/rate-limit';

describe('windowStartFor', () => {
  it('truncates to start of wall-clock minute', () => {
    // 2024-01-01T00:00:30.500Z -> 2024-01-01T00:00:00.000Z
    const input = new Date('2024-01-01T00:00:30.500Z');
    const result = windowStartFor(input);
    expect(result.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('returns the input if already aligned to minute boundary', () => {
    const input = new Date('2024-01-01T00:01:00.000Z');
    const result = windowStartFor(input);
    expect(result.toISOString()).toBe('2024-01-01T00:01:00.000Z');
  });

  it('handles milliseconds before minute boundary', () => {
    // 2024-01-01T00:01:59.999Z -> 2024-01-01T00:01:00.000Z
    const input = new Date('2024-01-01T00:01:59.999Z');
    const result = windowStartFor(input);
    expect(result.toISOString()).toBe('2024-01-01T00:01:00.000Z');
  });

  it('handles minutes across hour boundaries', () => {
    // 2024-01-01T00:59:30Z -> 2024-01-01T00:59:00.000Z
    const input = new Date('2024-01-01T00:59:30Z');
    const result = windowStartFor(input);
    expect(result.toISOString()).toBe('2024-01-01T00:59:00.000Z');
  });
});

describe('retryAfterSeconds', () => {
  it('returns positive seconds until window end when within window', () => {
    // windowStart = 12:00:00, now = 12:00:30, retryAfter = 30
    const windowStart = new Date('2024-01-01T12:00:00.000Z');
    const now = new Date('2024-01-01T12:00:30.000Z');
    expect(retryAfterSeconds(now, windowStart)).toBe(30);
  });

  it('returns 0 when window has passed', () => {
    const windowStart = new Date('2024-01-01T12:00:00.000Z');
    const now = new Date('2024-01-01T12:01:00.001Z');
    expect(retryAfterSeconds(now, windowStart)).toBe(0);
  });

  it('rounds up sub-second remainders', () => {
    const windowStart = new Date('2024-01-01T12:00:00.000Z');
    // 100ms before window end -> ceil(100/1000) = 1
    const now = new Date('2024-01-01T12:00:59.900Z');
    expect(retryAfterSeconds(now, windowStart)).toBe(1);
  });

  it('returns 60 when called at start of window', () => {
    const windowStart = new Date('2024-01-01T12:00:00.000Z');
    const now = windowStart;
    expect(retryAfterSeconds(now, windowStart)).toBe(60);
  });
});
