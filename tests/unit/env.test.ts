import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('env loader', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(process.env)) {
      if (k !== 'PATH' && k !== 'SystemRoot' && k !== 'PATHEXT' && k !== 'OS') {
        delete process.env[k];
      }
    }
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, originalEnv);
  });

  it('does not throw when DATABASE_URL missing (M28.bug16 — schema is .optional())', async () => {
    // M28.bug16 made DATABASE_URL optional so `next build` succeeds
    // before the init wizard has written .env. The Prisma client
    // construction (src/lib/db/client) is now the place that surfaces
    // "DATABASE_URL is required" at runtime, not env validation.
    const { env } = await import('@/lib/config/env');
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('loads required vars with defaults', async () => {
    process.env.DATABASE_URL = 'mysql://u:p@localhost:3306/db';
    const { env } = await import('@/lib/config/env');
    expect(env.DATABASE_URL).toBe('mysql://u:p@localhost:3306/db');
    expect(env.PORT).toBe(5002);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.NODE_ENV).toBe('development');
    expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('coerces PORT from string', async () => {
    process.env.DATABASE_URL = 'mysql://u:p@localhost:3306/db';
    process.env.PORT = '8080';
    const { env } = await import('@/lib/config/env');
    expect(env.PORT).toBe(8080);
  });

  it('rejects invalid LOG_LEVEL', async () => {
    process.env.DATABASE_URL = 'mysql://u:p@localhost:3306/db';
    process.env.LOG_LEVEL = 'banana';
    // The Proxy's parse() throws ZodError on the first access; we
    // trigger it by reading a property and catch the rejection.
    let captured: unknown = null;
    try {
      const mod = await import('@/lib/config/env');
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _ = mod.env.LOG_LEVEL;
    } catch (e: unknown) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toMatch(/LOG_LEVEL/);
  });

  it('treats empty-string SCHEDULER_BATCH_SIZE as missing (uses default)', async () => {
    // Regression: when .env contains `SCHEDULER_BATCH_SIZE=` (empty value),
    // an admin saved a blank form field. process.env sees "" which zod's
    // coerce.number() turns into 0 and then `.positive()` rejects. Treat
    // empty string as undefined so the default kicks in.
    process.env.DATABASE_URL = 'mysql://u:p@localhost:3306/db';
    process.env.SCHEDULER_BATCH_SIZE = '';
    process.env.SCHEDULER_TICK_MS = '';
    process.env.NIGHTLY_SWEEP_INTERVAL_MS = '';
    const { env } = await import('@/lib/config/env');
    expect(env.SCHEDULER_BATCH_SIZE).toBe(10);
    expect(env.SCHEDULER_TICK_MS).toBe(60_000);
    expect(env.NIGHTLY_SWEEP_INTERVAL_MS).toBe(24 * 60 * 60_000);
  });

  it('treats literal "0" SCHEDULER_BATCH_SIZE as missing (legacy .env drift)', async () => {
    // Regression: production .env contained SCHEDULER_BATCH_SIZE=0 because
    // the admin form submitted Number('') === 0. zod's .positive() rejects
    // 0, taking down login. Normalise "0" string to undefined so default
    // recovers the service without manual intervention.
    process.env.DATABASE_URL = 'mysql://u:p@localhost:3306/db';
    process.env.SCHEDULER_BATCH_SIZE = '0';
    process.env.SCHEDULER_TICK_MS = '0';
    process.env.NIGHTLY_SWEEP_INTERVAL_MS = '0';
    process.env.TOKEN_AUTO_DISABLE_THRESHOLD = '0';
    const { env } = await import('@/lib/config/env');
    expect(env.SCHEDULER_BATCH_SIZE).toBe(10);
    expect(env.SCHEDULER_TICK_MS).toBe(60_000);
    expect(env.NIGHTLY_SWEEP_INTERVAL_MS).toBe(24 * 60 * 60_000);
    // TOKEN_AUTO_DISABLE_THRESHOLD allows 0 (it means "disable auto-disable"),
    // so it should pass through as 0.
    expect(env.TOKEN_AUTO_DISABLE_THRESHOLD).toBe(0);
  });
});
