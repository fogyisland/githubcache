import { describe, it, expect } from 'vitest';
import { shouldHideSiteHeader } from '@/app/_components/site-header-visibility';

/**
 * The /admin shell has its own top utility bar (.ghc-admin-utility) that
 * is full-width. Rendering the public SiteHeader above it leaves two
 * top bars with misaligned inner edges (SiteHeader is constrained to
 * max-w-6xl + mx-auto; admin utility is 100% width with 24px padding).
 * SiteHeader should be skipped on /admin/* so the admin top chrome is
 * the only thing rendered.
 *
 * Middleware only sets x-pathname for /admin/* (see middleware.ts:66),
 * so the header is null for other routes — that's what we expect.
 */
describe('shouldHideSiteHeader', () => {
  it('hides SiteHeader on /admin', () => {
    expect(shouldHideSiteHeader('/admin')).toBe(true);
  });

  it('hides SiteHeader on nested /admin/* paths', () => {
    expect(shouldHideSiteHeader('/admin/users')).toBe(true);
    expect(shouldHideSiteHeader('/admin/api-keys/123')).toBe(true);
    expect(shouldHideSiteHeader('/admin/github-tokens')).toBe(true);
  });

  it('keeps SiteHeader on public routes', () => {
    expect(shouldHideSiteHeader('/')).toBe(false);
    expect(shouldHideSiteHeader('/get-started')).toBe(false);
    expect(shouldHideSiteHeader('/status')).toBe(false);
    expect(shouldHideSiteHeader('/account')).toBe(false);
    expect(shouldHideSiteHeader('/repo/octocat/hello-world')).toBe(false);
  });

  it('keeps SiteHeader when pathname is null (public route, middleware did not stamp)', () => {
    // middleware only stamps x-pathname inside the /admin branch.
    // On any other route the header comes back as null and the
    // SiteHeader should still render normally.
    expect(shouldHideSiteHeader(null)).toBe(false);
  });
});