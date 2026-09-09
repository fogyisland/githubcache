/**
 * next-intl server-side config. Reads the resolved locale from
 * `requestLocale` (set by middleware via `createMiddleware`) and
 * loads the matching messages bundle.
 *
 * Per next-intl 3.x docs: `getRequestConfig` runs on the server.
 *
 * M28.bug22 — the previous dynamic import `await import(\`../../messages/${locale}.json\`)`
 * was flagged by webpack as a "weak dependency" (template-literal
 * `import()` that webpack can't statically resolve into the chunk graph).
 * The JSON files shipped but webpack's runtime couldn't reach them
 * at request time, so every server component that consumed translations
 * threw `MODULE_NOT_FOUND` for `./en.json`.
 *
 * Fix: import each locale statically. Webpack sees explicit imports
 * and bundles the JSON into the server output. The Locale switch is
 * a plain object lookup at runtime.
 */

import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, type Locale } from '@/i18n/config';
import { isLocale } from '@/lib/lang/registry';

import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh.json';

const MESSAGES: Record<Locale, Record<string, unknown>> = {
  en: enMessages,
  zh: zhMessages,
};

export default getRequestConfig(async ({ requestLocale }) => {
  let locale: Locale | undefined = undefined;
  const req = await requestLocale;
  if (typeof req === 'string' && isLocale(req)) locale = req;
  if (!locale) locale = defaultLocale;
  return {
    locale,
    messages: MESSAGES[locale],
    timeZone: 'UTC',
  };
});
