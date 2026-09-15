import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

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

// In-memory fs so lockSetupSubtask's .env write doesn't touch the real .env.
// We track the "current .env content" as a string; the mock implementation
// reads/writes that string via the same functions real node:fs exposes.
const envContent: { value: string } = { value: 'DATABASE_URL=mysql://root:pw@127.0.0.1:3306/test\n' };
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: (path: string, _enc: string) => {
      if (typeof path === 'string' && path.endsWith('.env')) return envContent.value;
      return actual.readFileSync(path, _enc as never);
    },
    writeFileSync: (path: string, data: string) => {
      if (typeof path === 'string' && path.endsWith('.env')) {
        envContent.value = String(data);
        return;
      }
      return actual.writeFileSync(path, data);
    },
    existsSync: (path: string) => {
      if (typeof path === 'string' && path.endsWith('.env')) return true;
      return actual.existsSync(path);
    },
  };
});

import { lockSetupSubtask } from '@/app/init/_actions/finalize-setup';

describe('lockSetupSubtask (M32.6.5 — durable .env signal so fresh dev:server does not 307 back to /init)', () => {
  beforeEach(() => {
    cookieSets.length = 0;
    envContent.value = 'DATABASE_URL=mysql://root:pw@127.0.0.1:3306/test\nPORT=5002\n';
    delete process.env.GHC_SETUP_DONE;
  });

  afterEach(() => {
    delete process.env.GHC_SETUP_DONE;
  });

  it('sets ghc_setup_done=1 cookie so the Edge middleware stops redirecting to /init', async () => {
    const r = await lockSetupSubtask();
    expect(r.ok).toBe(true);

    const setCookie = cookieSets.find((c) => c.name === 'ghc_setup_done');
    expect(setCookie, 'ghc_setup_done cookie should be set').toBeDefined();
    expect(setCookie?.value).toBe('1');
    expect(setCookie?.path).toBe('/');
    expect(setCookie?.maxAge).toBeGreaterThanOrEqual(60 * 60 * 24 * 365 * 9);
    expect(setCookie?.sameSite).toBe('lax');
  });

  it('persists GHC_SETUP_DONE=1 to .env so a fresh dev:server boot picks it up via process.env', async () => {
    const before = envContent.value;
    expect(before).not.toContain('GHC_SETUP_DONE'); // sanity

    const r = await lockSetupSubtask();
    expect(r.ok).toBe(true);

    expect(envContent.value).toContain('GHC_SETUP_DONE=1');
    expect(process.env.GHC_SETUP_DONE).toBe('1');

    // Existing keys are preserved (we must not blow away DATABASE_URL)
    expect(envContent.value).toContain('DATABASE_URL=mysql://root:pw@127.0.0.1:3306/test');
    expect(envContent.value).toContain('PORT=5002');
  });

  it('is idempotent — running twice does not throw and does not duplicate the .env line', async () => {
    const a = await lockSetupSubtask();
    const b = await lockSetupSubtask();
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const ghcSets = cookieSets.filter((c) => c.name === 'ghc_setup_done');
    expect(ghcSets.length).toBe(2);

    // upsertEnvLine replaces, does not append — exactly one GHC_SETUP_DONE line
    const matches = envContent.value.match(/^GHC_SETUP_DONE=/gm) ?? [];
    expect(matches.length).toBe(1);
  });

  it('persists scheduler defaults (SCHEDULER_TICK_MS=1000, SCHEDULER_BATCH_SIZE=1) so a fresh dev:server boot drains at ~1 repo/sec instead of the 60s/10-job defaults', async () => {
    const r = await lockSetupSubtask();
    expect(r.ok).toBe(true);

    // New keys are written
    expect(envContent.value).toContain('SCHEDULER_TICK_MS=1000');
    expect(envContent.value).toContain('SCHEDULER_BATCH_SIZE=1');

    // Pre-existing keys are preserved (we must not blow away DATABASE_URL
    // or PORT, and the existing GHC_SETUP_DONE write still happens)
    expect(envContent.value).toContain('DATABASE_URL=mysql://root:pw@127.0.0.1:3306/test');
    expect(envContent.value).toContain('PORT=5002');
    expect(envContent.value).toContain('GHC_SETUP_DONE=1');
  });

  it('is idempotent for scheduler defaults — running lockSetupSubtask twice yields exactly one SCHEDULER_TICK_MS line and exactly one SCHEDULER_BATCH_SIZE line', async () => {
    const a = await lockSetupSubtask();
    const b = await lockSetupSubtask();
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const tickMatches = envContent.value.match(/^SCHEDULER_TICK_MS=/gm) ?? [];
    expect(tickMatches.length).toBe(1);

    const batchMatches = envContent.value.match(/^SCHEDULER_BATCH_SIZE=/gm) ?? [];
    expect(batchMatches.length).toBe(1);

    // And the values are still the right ones after the second pass
    expect(envContent.value).toContain('SCHEDULER_TICK_MS=1000');
    expect(envContent.value).toContain('SCHEDULER_BATCH_SIZE=1');
  });
});