import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import {
  DEFAULT_ADMIN_VARIANT,
  isAdminVariant,
  resolveAdminVariant,
  type AdminVariantId,
} from '@/lib/admin/variant';

export const ADMIN_VARIANT_COOKIE = 'ghc_admin_variant';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Read the admin variant from a `next/headers` headers() entry. Falls back to
 * DEFAULT_ADMIN_VARIANT when the cookie is missing, malformed, or carries an
 * unknown variant id — by design, the variant always resolves to a known id.
 */
export function readAdminVariantFromCookieHeader(cookieHeader: string | null): AdminVariantId {
  const fakeRequest = {
    headers: { get: (name: string) => (name.toLowerCase() === 'cookie' ? cookieHeader : null) },
  } as unknown as Request;
  return readAdminVariantFromRequest(fakeRequest);
}

/**
 * Read the admin variant from a Web `Request`. Used by route handlers that
 * receive the raw NextRequest.
 */
export function readAdminVariantFromRequest(req: Request): AdminVariantId {
  const cookies = cookiesFromRequest(req);
  const raw = cookies.get(ADMIN_VARIANT_COOKIE)?.value;
  return resolveAdminVariant(raw);
}

/**
 * Build the `Set-Cookie` header value for an admin variant change.
 * SameSite=Lax so the cookie is sent on top-level navigations; not HttpOnly
 * because the cookie is read by SSR (server), not by JS.
 */
export function buildAdminVariantSetCookie(id: AdminVariantId): string {
  const safe = isAdminVariant(id) ? id : DEFAULT_ADMIN_VARIANT;
  const value = encodeURIComponent(safe);
  return `${ADMIN_VARIANT_COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}