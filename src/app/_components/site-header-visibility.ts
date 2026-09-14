/**
 * Whether the public SiteHeader should be hidden on a given pathname.
 *
 * The admin layout already has its own top utility bar (.ghc-admin-utility)
 * that is full-width. Rendering the public SiteHeader above it leaves two
 * top bars with misaligned inner edges (SiteHeader is constrained to
 * max-w-6xl + mx-auto; admin utility is 100% width with 24px padding) —
 * the user sees the inner content not lining up vertically between the
 * two headers. Skipping SiteHeader on /admin/* keeps the admin chrome
 * consistent with the rest of the admin surface.
 *
 * `middleware.ts` only stamps `x-pathname` inside the /admin branch, so
 * `pathname` is null for every non-admin request — `null` means "not on
 * /admin, keep the header visible."
 */
export function shouldHideSiteHeader(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === '/admin' || pathname.startsWith('/admin/');
}