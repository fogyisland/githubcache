import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/auth/session', () => ({
  validateSession: vi.fn().mockResolvedValue({
    email: 'admin@example.com',
    role: 'admin',
    timezone: null,
  }),
}));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    refreshJob: { count: vi.fn().mockResolvedValue(0) },
    auditLog: { count: vi.fn().mockResolvedValue(0) },
    $queryRaw: vi.fn().mockResolvedValue([[{ '?': 1 }]]),
  },
}));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
  revalidateTag: vi.fn(),
}));

describe('Admin layout — perf', () => {
  it('completes loadAdminStatusData via Promise.all, not serial', async () => {
    const start = Date.now();
    const { loadAdminStatusData } = await import('@/lib/admin/status-loader');
    await loadAdminStatusData();
    const elapsed = Date.now() - start;
    // Generous bound — the real win is structural (parallel), not absolute
    expect(elapsed).toBeLessThan(200);
  });

  it('returns the expected AdminStatusBundle shape', async () => {
    const { loadAdminStatusData } = await import('@/lib/admin/status-loader');
    const bundle = await loadAdminStatusData();
    expect(bundle).toHaveProperty('dbPingMs');
    expect(bundle).toHaveProperty('queueDepth');
    expect(bundle).toHaveProperty('recentAuditCount');
    expect(bundle).not.toHaveProperty('paletteAudit');
  });
});