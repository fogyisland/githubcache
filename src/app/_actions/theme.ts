'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { THEME_IDS, isThemeId, type ThemeId } from '@/lib/theme/themes';
import { THEME_COOKIE } from '@/lib/theme/cookie';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';

export interface SetThemeState {
  status: 'idle' | 'ok' | 'invalid' | 'error';
  message?: string;
  theme?: ThemeId;
}

const ThemeSchema = z.object({
  theme: z.enum(THEME_IDS),
});

/**
 * Server action: switch the current viewer's theme.
 *
 * - Always writes the ghc_theme cookie (so anon visitors get persistence too).
 * - If the request is from a logged-in user, also persists the choice on
 *   `users.theme` so the preference follows them across devices.
 * - Re-renders the layout so the next paint picks up the new data-theme.
 *
 * Returns the new theme on success, or a validation/error state on failure.
 * The ThemeSwitcher client component is the only caller.
 */
export async function setThemeAction(
  _prev: SetThemeState,
  formData: FormData,
): Promise<SetThemeState> {
  const raw = formData.get('theme');
  const parsed = ThemeSchema.safeParse({ theme: raw });
  if (!parsed.success) {
    return {
      status: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'unknown theme',
    };
  }
  const theme = parsed.data.theme;
  if (!isThemeId(theme)) {
    return { status: 'invalid', message: 'unknown theme' };
  }

  // 1. Always set the cookie (works for anon + logged-in alike)
  const cookieStore = await cookies();
  cookieStore.set({
    name: THEME_COOKIE,
    value: theme,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: false,
  });

  // 2. If logged in, persist on the user record so the choice follows them
  //    across devices / cookie clears. DB write is best-effort.
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
        data: { theme },
      });
      logger.info(
        { userId: user.id.toString(), theme, sidPrefix: cookieMap[SESSION_COOKIE_NAME]?.slice(0, 4) },
        'theme persisted on user',
      );
    }
  } catch (e: unknown) {
    // Non-fatal: cookie was set; DB write is best-effort.
    logger.warn({ err: e, theme }, 'failed to persist theme on user');
  }

  // 3. Bust caches so the new theme shows up on every route immediately.
  revalidatePath('/', 'layout');

  return { status: 'ok', theme };
}