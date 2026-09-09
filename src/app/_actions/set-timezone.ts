'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { TIMEZONE_IDS, isTimezone, type TimezoneId } from '@/lib/timezone/registry';
import { TIMEZONE_COOKIE_MAX_AGE_SECONDS, TIMEZONE_COOKIE_NAME } from '@/lib/timezone/constants';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';

export interface SetTimezoneState {
  status: 'idle' | 'ok' | 'invalid' | 'error';
  message?: string;
  timezone?: TimezoneId;
}

const TimezoneSchema = z.object({
  timezone: z.enum(TIMEZONE_IDS),
});

/**
 * Server action: switch the current viewer's timezone.
 *
 * Mirrors `src/app/_actions/set-lang.ts`:
 *   - Always writes the ghc_tz cookie (anon + logged-in alike).
 *   - If logged in, persists `users.timezone` so the preference follows across devices.
 *   - DB write is best-effort (cookie is the source of truth for the request).
 *   - revalidatePath so the new timezone shows on every admin route immediately.
 */
export async function setTimezoneAction(
  _prev: SetTimezoneState,
  formData: FormData,
): Promise<SetTimezoneState> {
  const raw = formData.get('timezone');
  const parsed = TimezoneSchema.safeParse({ timezone: raw });
  if (!parsed.success) {
    return {
      status: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'invalid timezone',
    };
  }
  const tz = parsed.data.timezone;
  if (!isTimezone(tz)) {
    // Defense-in-depth: z.enum already narrowed, but a refactor could loosen that.
    return { status: 'invalid', message: 'unknown timezone' };
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: TIMEZONE_COOKIE_NAME,
    value: tz,
    path: '/',
    maxAge: TIMEZONE_COOKIE_MAX_AGE_SECONDS,
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
        data: { timezone: tz },
      });
      logger.info(
        {
          userId: user.id.toString(),
          tz,
          sidPrefix: cookieMap[SESSION_COOKIE_NAME]?.slice(0, 4),
        },
        'timezone persisted on user',
      );
    }
  } catch (e: unknown) {
    logger.warn({ err: e, tz }, 'failed to persist timezone on user');
  }

  revalidatePath('/', 'layout');
  return { status: 'ok', timezone: tz };
}
