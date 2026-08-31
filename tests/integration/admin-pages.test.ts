import { describe, it, expect, vi } from 'vitest';

// Mock next/headers BEFORE importing the page components so the module
// loader picks up our mocked cookies() / validateSession chain.
const mockValidateSession = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => [],
  }),
}));

vi.mock('@/lib/auth/session', () => ({
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}));

// Mock redirect to capture the call instead of throwing the Next.js
// internal NEXT_REDIRECT error (which surfaces as an unhandled exception
// in Vitest).
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`__redirect_to__${url}`);
});
vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
  notFound: () => {
    throw new Error('__not_found__');
  },
}));

describe('page-level admin role check', () => {
  it('redirects to /admin when no session is present (AdminUsersPage)', async () => {
    mockValidateSession.mockResolvedValueOnce(null);
    const AdminUsersPage = (await import('@/app/admin/users/page')).default;
    await expect(AdminUsersPage({ searchParams: {} })).rejects.toThrow(
      '__redirect_to__/admin',
    );
    expect(mockRedirect).toHaveBeenCalledWith('/admin');
  });

  it('redirects to /admin when the user is an operator (AdminUsersPage)', async () => {
    mockValidateSession.mockResolvedValueOnce({
      id: 1n,
      email: 'op@example.test',
      role: 'operator',
      status: 'active',
    } as never);
    // listUsers() and listInvitations() are imported eagerly by the page
    // module — we just need to ensure the redirect fires BEFORE they're
    // called. The page short-circuits on `redirect()`, so we don't care
    // if those module-level imports fail; we only care that the redirect
    // is invoked first. If they are eagerly evaluated, the test will fail
    // with a DB error — but we expect the redirect throw to win because
    // it's synchronous after the await on validateSession.
    const AdminUsersPage = (await import('@/app/admin/users/page')).default;
    await expect(AdminUsersPage({ searchParams: {} })).rejects.toThrow(
      '__redirect_to__/admin',
    );
    expect(mockRedirect).toHaveBeenCalledWith('/admin');
  });

  it('redirects to /admin when the user is an operator (AdminUserDetailPage)', async () => {
    mockValidateSession.mockResolvedValueOnce({
      id: 1n,
      email: 'op@example.test',
      role: 'operator',
      status: 'active',
    } as never);
    const AdminUserDetailPage = (await import('@/app/admin/users/[id]/page')).default;
    await expect(AdminUserDetailPage({ params: { id: '1' } })).rejects.toThrow(
      '__redirect_to__/admin',
    );
    expect(mockRedirect).toHaveBeenCalledWith('/admin');
  });

  it('redirects to /admin when the user is an operator (AdminGithubTokensPage)', async () => {
    mockValidateSession.mockResolvedValueOnce({
      id: 1n,
      email: 'op@example.test',
      role: 'operator',
      status: 'active',
    } as never);
    const AdminGithubTokensPage = (await import('@/app/admin/github-tokens/page')).default;
    await expect(AdminGithubTokensPage({ searchParams: {} })).rejects.toThrow(
      '__redirect_to__/admin',
    );
    expect(mockRedirect).toHaveBeenCalledWith('/admin');
  });

  it('redirects to /login when no session is present (AdminQueuePage)', async () => {
    mockValidateSession.mockResolvedValueOnce(null);
    const AdminQueuePage = (await import('@/app/admin/queue/page')).default;
    await expect(AdminQueuePage({})).rejects.toThrow('__redirect_to__/login');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  it('redirects to /admin when the user is an operator (AdminQueuePage)', async () => {
    mockValidateSession.mockResolvedValueOnce({
      id: 1n,
      email: 'op@example.test',
      role: 'operator',
      status: 'active',
    } as never);
    const AdminQueuePage = (await import('@/app/admin/queue/page')).default;
    await expect(AdminQueuePage({})).rejects.toThrow('__redirect_to__/admin');
    expect(mockRedirect).toHaveBeenCalledWith('/admin');
  });
});