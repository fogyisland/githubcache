import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { DEFAULT_THEME, isThemeId, resolveTheme, type ThemeId } from '@/lib/theme/themes';

export const THEME_COOKIE = 'ghc_theme';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Read the theme from a `next/headers` headers() entry. Falls back to
 * DEFAULT_THEME when the cookie is missing, malformed, or carries an
 * unknown theme id — by design, theme always resolves to a known id.
 */
export function readThemeFromCookieHeader(cookieHeader: string | null): ThemeId {
  const fakeRequest = {
    headers: { get: (name: string) => (name.toLowerCase() === 'cookie' ? cookieHeader : null) },
  } as unknown as Request;
  return readThemeFromRequest(fakeRequest);
}

/**
 * Read the theme from a Web `Request`. Used by route handlers that receive
 * the raw NextRequest.
 */
export function readThemeFromRequest(req: Request): ThemeId {
  const cookies = cookiesFromRequest(req);
  const raw = cookies.get(THEME_COOKIE)?.value;
  return resolveTheme(raw);
}

/**
 * Build the `Set-Cookie` header value for a theme change. SameSite=Lax so
 * the cookie is sent on top-level navigations (the home page is one); not
 * HttpOnly because the cookie is read by SSR (server), not by JS.
 */
export function buildThemeSetCookie(id: ThemeId): string {
  const safe = isThemeId(id) ? id : DEFAULT_THEME;
  const value = encodeURIComponent(safe);
  return `${THEME_COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}