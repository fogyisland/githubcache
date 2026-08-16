import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/db/client';

type ServerHandle = {
  server: { listening: boolean };
  scheduler: { stop(): void };
  shutdown(): Promise<void>;
};

describe('server boot (smoketest)', () => {
  let handle: ServerHandle | undefined;

  beforeAll(async () => {
    // Ensure DATABASE_URL is set so the env schema parses. The repo .env file
    // is loaded by tests/setup.ts. We only override PORT per-test below.
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set (via .env or process.env)');
    }
  });

  afterAll(async () => {
    if (handle) {
      await handle.shutdown();
    }
    // Belt-and-braces cleanup: disconnect the shared Prisma client so vitest's
    // worker exits cleanly even if a test fails before calling handle.shutdown().
    await prisma.$disconnect();
  });

  it('boots, serves /api/v1/status, shuts down cleanly', async () => {
    process.env.PORT = '3101';
    // env is parsed at module load time, so reset modules and re-import with
    // the new PORT in process.env.
    vi.resetModules();
    const { bootServer } = await import('@/server');
    handle = await bootServer();

    // Hit the status endpoint
    const res = await fetch(`http://localhost:${process.env.PORT}/api/v1/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ok');
    expect(body).toHaveProperty('db');
  }, 30_000);

  it('exposes a shutdown() method that stops the HTTP server', async () => {
    process.env.PORT = '3102';
    vi.resetModules();
    const { bootServer } = await import('@/server');
    const h = await bootServer();
    expect(h.server.listening).toBe(true);
    await h.shutdown();
    expect(h.server.listening).toBe(false);
  }, 30_000);
});
