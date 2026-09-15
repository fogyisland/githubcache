/**
 * M32.7.4 — comprehensive defense against NODE_ENV misconfiguration.
 *
 * Root cause: cloud production ran with NODE_ENV=development (inherited
 * from .env.example). `src/bootstrap.ts:30` originally only set
 * NODE_ENV=production when it was *undefined* — so when .env had
 * NODE_ENV=development (a truthy value), the fallback was a no-op and
 * Node shipped the dev React bundle on top of an already-broken `npm
 * start` execution.
 *
 * The new `enforceProductionNodeEnv()` is the **runtime last-line-of-
 * defense**: it forces NODE_ENV=production whenever the value is
 * 'development' OR undefined, and warns the operator. This test pins
 * the contract so the safety net can't silently regress.
 */
import { describe, it, expect, vi } from 'vitest';
import { enforceProductionNodeEnv } from '@/lib/bootstrap-node-env';

describe('enforceProductionNodeEnv (M32.7.4 — last-line-of-defense)', () => {
  it('forces NODE_ENV=production when value is undefined', () => {
    const env: Record<string, string | undefined> = {};
    const log = vi.fn();
    const prev = enforceProductionNodeEnv(env, log);
    expect(env.NODE_ENV).toBe('production');
    expect(prev).toBe('undefined');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("NODE_ENV was 'undefined'"));
  });

  it('forces NODE_ENV=production when value is "development"', () => {
    const env: Record<string, string | undefined> = { NODE_ENV: 'development' };
    const log = vi.fn();
    const prev = enforceProductionNodeEnv(env, log);
    expect(env.NODE_ENV).toBe('production');
    expect(prev).toBe('development');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("NODE_ENV was 'development'"));
  });

  it('does NOT change NODE_ENV when value is already "production"', () => {
    const env: Record<string, string | undefined> = { NODE_ENV: 'production' };
    const log = vi.fn();
    const prev = enforceProductionNodeEnv(env, log);
    expect(env.NODE_ENV).toBe('production');
    expect(prev).toBe('production');
    expect(log).not.toHaveBeenCalled();
  });

  it('does NOT change NODE_ENV when value is "test" (vitest internal)', () => {
    // vitest sets NODE_ENV=test for unit tests. The function must respect
    // any non-development/non-undefined value — we don't want to clobber
    // 'test' or 'staging'.
    const env: Record<string, string | undefined> = { NODE_ENV: 'test' };
    const log = vi.fn();
    const prev = enforceProductionNodeEnv(env, log);
    expect(env.NODE_ENV).toBe('test');
    expect(prev).toBe('test');
    expect(log).not.toHaveBeenCalled();
  });

  it('returns the previous value for logging/tests', () => {
    expect(enforceProductionNodeEnv({ NODE_ENV: 'development' })).toBe('development');
    expect(enforceProductionNodeEnv({ NODE_ENV: undefined })).toBe('undefined');
    expect(enforceProductionNodeEnv({ NODE_ENV: 'production' })).toBe('production');
  });

  it('uses console.warn by default (so the message shows in operator logs)', () => {
    // We don't assert on console.warn directly (vitest captures it) — just
    // ensure the function works without an explicit log callback.
    const env: Record<string, string | undefined> = { NODE_ENV: 'development' };
    expect(() => enforceProductionNodeEnv(env)).not.toThrow();
    expect(env.NODE_ENV).toBe('production');
  });
});