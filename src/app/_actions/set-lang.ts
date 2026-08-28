'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LOCALES, type Locale } from '@/i18n/config';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { LANG_COOKIE_NAME } from '@/lib/lang/constants';

export interface SetLangState {
  status: 'idle' | 'ok' | 'invalid' | 'error';
  message?: string;
  locale?: Locale;
}

const LangSchema = z.object({
  locale: z.enum(LOCALES),
});

/**
 * Server action: switch the current viewer's language.
 *
 * Mirrors `src/app/_actions/theme.ts`:
 *   - Always writes the ghc_lang cookie (anon + logged-in alike).
 *   - If logged in, persists `users.lang` so the preference follows across devices.
 *   - DB write is best-effort (cookie is the source of truth for the request).
 *   - revalidatePath so the new lang shows on every route immediately.
 */
export async function setLangAction(
  _prev: SetLangState,
  formData: FormData,
): Promise<SetLangState> {
  const raw = formData.get('locale');
  const parsed = LangSchema.safeParse({ locale: raw });
  if (!parsed.success) {
    return {
      status: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'invalid locale',
    };
  }
  const locale = parsed.data.locale;

  const cookieStore = cookies();
  cookieStore.set({
    name: LANG_COOKIE_NAME,
    value: locale,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: false,
  });

  try {
    const cookieMap = Object.fromEntries(
      cookieStore.getAll().map((c) => [c.name, c.value]),
    );
    const user = await validateSession({
      headers: new Headers(),
      cookies: {
        get: (name: string) =>
          cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
      },
    });
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { lang: locale },
      });
      logger.info(
        { userId: user.id.toString(), locale, sidPrefix: cookieMap[SESSION_COOKIE_NAME]?.slice(0, 4) },
        'lang persisted on user',
      );
    }
  } catch (e: unknown) {
    logger.warn({ err: e, locale }, 'failed to persist lang on user');
  }

  revalidatePath('/', 'layout');
  return { status: 'ok', locale };
}
