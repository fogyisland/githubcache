/**
 * Locale registry + resolution. Mirrors `src/lib/theme/registry.ts`.
 *
 * Detection order:
 *   1. cookie `ghc_lang` if valid
 *   2. DB `users.lang` if valid
 *   3. Accept-Language header (en-* → 'en')
 *   4. defaultLocale ('zh')
 */

import { LOCALES, defaultLocale, type Locale } from '@/i18n/config';

export { LOCALES, defaultLocale };
export type { Locale };

export function isLocale(s: string | undefined | null): s is Locale {
  return typeof s === 'string' && (LOCALES as readonly string[]).includes(s);
}

export interface ResolveLocaleOptions {
  cookieValue?: string | null;
  dbValue?: string | null;
  acceptLanguage?: string | null;
}

export function resolveLocale(opts: ResolveLocaleOptions): Locale {
  if (isLocale(opts.cookieValue)) return opts.cookieValue;
  if (isLocale(opts.dbValue)) return opts.dbValue;
  const al = (opts.acceptLanguage ?? '').toLowerCase();
  if (al.startsWith('en')) return 'en';
  return defaultLocale;
}
