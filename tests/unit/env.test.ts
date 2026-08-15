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

  it('throws when DATABASE_URL missing', async () => {
    await expect(import('@/lib/config/env')).rejects.toThrow(/DATABASE_URL/);
  });

  it('loads required vars with defaults', async () => {
    process.env.DATABASE_URL = 'mysql://u:p@localhost:3306/db';
    const { env } = await import('@/lib/config/env');
    expect(env.DATABASE_URL).toBe('mysql://u:p@localhost:3306/db');
    expect(env.PORT).toBe(3000);
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
    await expect(import('@/lib/config/env')).rejects.toThrow();
  });
});
