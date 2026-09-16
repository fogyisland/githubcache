import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock next/headers BEFORE importing the page so module loader picks up
// our mocked cookies/validateSession chain — same pattern as
// admin-pages.test.ts.
const mockValidateSession = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => [],
  }),
  headers: () => ({ get: () => null }),
}));

vi.mock('@/lib/auth/session', () => ({
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}));

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`__redirect_to__${url}`);
});
vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
  notFound: () => {
    throw new Error('__not_found__');
  },
}));

// Mock the new loader so the page doesn't hit the DB.
const mockGithubVolume = vi.fn();
vi.mock('@/lib/admin/github-request-volume', () => ({
  loadGithubRequestVolume: (...args: unknown[]) => mockGithubVolume(...args),
}));

// Mock the other dashboard loaders — keeps the test focused on the new
// section. Page will still call them via Promise.all but they're cheap.
vi.mock('@/lib/db/audit', () => ({
  queryAuditLog: async () => ({ rows: [], total: 0 }),
  getActorEmails: async () => new Map(),
}));

vi.mock('@/lib/admin/dashboard-buckets', () => ({
  loadDashboardBuckets: async () => [],
  getDashboardCounts: async () => ({
    cachedRepos: 0,
    activeUsers: 0,
    activeApiKeys: 0,
    activeGithubTokens: 0,
  }),
}));

vi.mock('@/lib/timezone/resolve', () => ({
  resolveRequestTimezone: async () => 'UTC',
}));

// Mock next-intl/server — getTranslations is server-only and throws in
// tests because it walks the server-component machinery we don't mock.
vi.mock('next-intl/server', () => ({
  getTranslations: async (_namespace: string) => {
    // Return a t() that resolves any key to its dotted path. Tests assert
    // on specific keys (e.g. "admin.shell.dashboard.githubVolume.heading"),
    // so as long as that path appears somewhere in the rendered output
    // we're good — and since we don't actually render the ReactElement,
    // we only need the loader call to fire.
    const fn = (key: string, vars?: Record<string, string | number>) => {
      if (vars) {
        return Object.entries(vars).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
          key,
        );
      }
      return key;
    };
    fn.rich = () => (k: string) => k;
    return fn;
  },
}));

beforeEach(() => {
  mockGithubVolume.mockReset();
  mockGithubVolume.mockResolvedValue(
    Array.from({ length: 24 }, (_, i) => ({
      hour: new Date(`2026-09-15T${String(i).padStart(2, '0')}:00:00Z`),
      core: 0,
      releases: 0,
      branches: 0,
    })),
  );
  mockValidateSession.mockResolvedValue({
    id: 1n,
    email: 'admin@example.test',
    role: 'admin',
    status: 0,
  });
});

describe('admin dashboard — M32.7.6 GitHub upstream volume wiring', () => {
  it('passes window="24h" to the loader when searchParams.window is omitted', async () => {
    const AdminDashboardPage = (await import('@/app/admin/page')).default;
    // Don't await — we just need the loader call to fire; we ignore the
    // Promise<ReactElement> return value (which would need ReactDOM to
    // actually render).
    void AdminDashboardPage({ searchParams: Promise.resolve({}) });
    // The loader is called via Promise.all, so we need to yield to the
    // microtask queue before asserting.
    await new Promise((r) => setImmediate(r));
    expect(mockGithubVolume).toHaveBeenCalledWith('24h');
  });

  it('passes window="7d" to the loader when ?window=7d is present', async () => {
    const AdminDashboardPage = (await import('@/app/admin/page')).default;
    void AdminDashboardPage({
      searchParams: Promise.resolve({ window: '7d' }),
    });
    await new Promise((r) => setImmediate(r));
    expect(mockGithubVolume).toHaveBeenCalledWith('7d');
  });

  it('treats unknown window values as 24h (no crash, no 404)', async () => {
    const AdminDashboardPage = (await import('@/app/admin/page')).default;
    void AdminDashboardPage({
      searchParams: Promise.resolve({ window: '99h' }),
    });
    await new Promise((r) => setImmediate(r));
    expect(mockGithubVolume).toHaveBeenCalledWith('24h');
  });

  it('does not throw on the empty-ring case (chart receives 24 zero-buckets)', async () => {
    const AdminDashboardPage = (await import('@/app/admin/page')).default;
    // Loader is already mocked to return 24 zero-buckets in beforeEach.
    let threw = false;
    try {
      await AdminDashboardPage({ searchParams: Promise.resolve({}) });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
