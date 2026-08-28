/**
 * Locale configuration. Mirrors `src/lib/theme/registry.ts` shape.
 *
 * - LOCALES: supported locales (zh default + en)
 * - defaultLocale: fallback when nothing else resolves
 * - LOCALE_LABELS / LOCALE_FULL_LABELS: switcher UI strings
 */

export const LOCALES = ['zh', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const defaultLocale: Locale = 'zh';

export const LOCALE_LABELS: Record<Locale, string> = {
  zh: '中',
  en: 'EN',
};

export const LOCALE_FULL_LABELS: Record<Locale, string> = {
  zh: '中文',
  en: 'English',
};
