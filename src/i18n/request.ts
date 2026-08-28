/**
 * next-intl server-side config. Reads the resolved locale from
 * `requestLocale` (set by middleware via `createMiddleware`) and
 * loads the matching messages bundle.
 *
 * Per next-intl 3.x docs: `getRequestConfig` runs on the server.
 */

import { getRequestConfig } from 'next-intl/server';
import { defaultLocale } from '@/i18n/config';
import { isLocale } from '@/lib/lang/registry';
import type { Locale } from '@/i18n/config';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale: Locale | undefined = undefined;
  const req = await requestLocale;
  if (typeof req === 'string' && isLocale(req)) locale = req;
  if (!locale) locale = defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: 'UTC',
  };
});
