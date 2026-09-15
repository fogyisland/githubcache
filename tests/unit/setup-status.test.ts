import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the prisma client BEFORE importing the module under test so that
// the Proxy in src/lib/db/client.ts never gets touched — the guard in
// setup-status.ts is supposed to short-circuit before any prisma call.
vi.mock('@/lib/db/client', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    user: { count: vi.fn() },
  },
}));

import { getSetupStatus } from '@/lib/init/setup-status';

describe('getSetupStatus (M32.7.2 — DATABASE_URL guard)', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    vi.restoreAllMocks();
  });

  it('returns database_unreachable without touching prisma when DATABASE_URL is unset', async () => {
    const status = await getSetupStatus();
    expect(status).toEqual({ done: false, reason: 'database_unreachable' });
  });

  it('does not invoke prisma when DATABASE_URL is unset', async () => {
    const prisma = (await import('@/lib/db/client')).prisma as unknown as {
      $queryRaw: ReturnType<typeof vi.fn>;
      user: { count: ReturnType<typeof vi.fn> };
    };
    await getSetupStatus();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.user.count).not.toHaveBeenCalled();
  });
});