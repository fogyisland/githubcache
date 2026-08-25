import { describe, it, expect, beforeEach } from 'vitest';
import { pause, resume, isPaused, getPausedAt } from '@/lib/scheduler/state';

describe('scheduler pause/resume state', () => {
  beforeEach(() => {
    // Ensure clean state — resume in case a prior test left the flag set.
    resume();
  });

  it('initial state: not paused, pausedAt is null', () => {
    expect(isPaused()).toBe(false);
    expect(getPausedAt()).toBeNull();
  });

  it('pause() sets the flag and a Date', () => {
    pause();
    expect(isPaused()).toBe(true);
    const ts = getPausedAt();
    expect(ts).toBeInstanceOf(Date);
    // Should be very recent (within a few seconds of now)
    expect(Math.abs(ts!.getTime() - Date.now())).toBeLessThan(5_000);
  });

  it('resume() clears the flag and the timestamp', () => {
    pause();
    resume();
    expect(isPaused()).toBe(false);
    expect(getPausedAt()).toBeNull();
  });

  it('pause() is idempotent — does NOT update pausedAt when called twice', () => {
    pause();
    const first = getPausedAt();
    // Tiny delay so a fresh Date would visibly differ
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* spin */
    }
    pause();
    const second = getPausedAt();
    expect(second).toEqual(first);
    expect(isPaused()).toBe(true);
  });

  it('resume() when not paused is a no-op (no crash, no state change)', () => {
    // Sanity: clean state
    expect(isPaused()).toBe(false);
    resume(); // already not paused
    expect(isPaused()).toBe(false);
    expect(getPausedAt()).toBeNull();

    // After pausing + resuming, calling resume() again is also safe
    pause();
    resume();
    expect(isPaused()).toBe(false);
    resume();
    expect(isPaused()).toBe(false);
    expect(getPausedAt()).toBeNull();
  });
});
