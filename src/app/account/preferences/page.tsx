import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { LangSwitcher } from '@/app/_components/lang-switcher';
import { ThemeSwitcher } from '@/app/_components/theme-switcher';
import { TimezoneSwitcher } from '@/app/_components/timezone-switcher';
import { LOCALES } from '@/i18n/config';
import { readLangFromCookieHeader } from '@/lib/lang/cookie';
import { readTimezoneFromCookieHeader } from '@/lib/timezone/cookie';
import { readThemeFromCookieHeader } from '@/lib/theme/cookie';
import { resolveLocale } from '@/lib/lang/registry';
import { resolveTimezone } from '@/lib/timezone/registry';
import { isThemeId } from '@/lib/theme/themes';

/**
 * M26 — /account/preferences.
 *
 * Re-uses the existing `setLangAction` / `setThemeAction` /
 * `setTimezoneAction` server actions via the existing switcher
 * client components. Layout is in form-style rows so the surface
 * looks distinct from the top-bar pill switchers.
 */
export default async function AccountPreferencesPage(): Promise<ReactElement> {
  const headersList = cookies();
  const cookieMap = Object.fromEntries(headersList.getAll().map((c) => [c.name, c.value]));
  const cookieHeader = headersList
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const user = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!user) return <></>;

  const t = await getTranslations('account.preferences');
  const currentLang = resolveLocale({
    cookieValue: readLangFromCookieHeader(cookieHeader),
    dbValue: user.lang,
  });
  const currentTz = resolveTimezone({
    cookieValue: readTimezoneFromCookieHeader(cookieHeader),
    dbValue: user.timezone,
  });
  const themeCookie = readThemeFromCookieHeader(cookieHeader);
  const currentTheme = isThemeId(themeCookie) ? themeCookie : user.theme;

  return (
    <div className="ghc-fade-up flex flex-col gap-6 max-w-2xl">
      <header>
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="mt-1 text-sm ghc-text-muted">{t('subtitle')}</p>
      </header>

      <PrefSection title={t('lang.label')} body={t('lang.body')}>
        <LangSwitcher current={currentLang} locales={LOCALES} />
      </PrefSection>

      <PrefSection title={t('theme.label')} body={t('theme.body')}>
        <ThemeSwitcher current={currentTheme} />
      </PrefSection>

      <PrefSection title={t('timezone.label')} body={t('timezone.body')}>
        <TimezoneSwitcher current={currentTz} />
      </PrefSection>
    </div>
  );
}

function PrefSection({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <section className="ghc-card p-6 flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm ghc-text-muted">{body}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}
