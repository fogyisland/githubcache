import { describe, expect, it, vi } from 'vitest';

// Capture cookies.set() calls so we can assert ghc_setup_done is set.
type CookieSetOpts = {
  name: string;
  value: string;
  httpOnly?: boolean;
  sameSite?: string;
  secure?: boolean;
  path?: string;
  maxAge?: number;
};
const cookieSets: CookieSetOpts[] = [];

vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => [],
    get: () => undefined,
    set: (opts: CookieSetOpts) => {
      cookieSets.push(opts);
    },
    delete: () => undefined,
  }),
}));

import { lockSetupSubtask } from '@/app/init/_actions/finalize-setup';

describe('lockSetupSubtask (M32.6 — middleware cookie signal)', () => {
  it('sets ghc_setup_done=1 so the Edge middleware stops redirecting to /init', async () => {
    cookieSets.length = 0;
    const r = await lockSetupSubtask();
    expect(r.ok).toBe(true);

    // Find the ghc_setup_done set-cookie call
    const setCookie = cookieSets.find((c) => c.name === 'ghc_setup_done');
    expect(setCookie, 'ghc_setup_done cookie should be set').toBeDefined();
    expect(setCookie?.value).toBe('1');
    expect(setCookie?.path).toBe('/');
    // 10 years in seconds — long-lived so server restarts don't lose it
    expect(setCookie?.maxAge).toBeGreaterThanOrEqual(60 * 60 * 24 * 365 * 9);
    expect(setCookie?.sameSite).toBe('lax');
  });

  it('is idempotent — running twice does not throw', async () => {
    cookieSets.length = 0;
    const a = await lockSetupSubtask();
    const b = await lockSetupSubtask();
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // Two set calls, both for the same cookie name
    const ghcSets = cookieSets.filter((c) => c.name === 'ghc_setup_done');
    expect(ghcSets.length).toBe(2);
  });
});