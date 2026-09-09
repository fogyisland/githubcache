'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ADMIN_VARIANT_IDS,
  isAdminVariant,
  type AdminVariantId,
} from '@/lib/admin/variant';
import { ADMIN_VARIANT_COOKIE } from '@/lib/admin/cookie';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';

export interface SetAdminVariantState {
  status: 'idle' | 'ok' | 'invalid' | 'error';
  message?: string;
  variant?: AdminVariantId;
}

const Schema = z.object({
  adminVariant: z.enum(ADMIN_VARIANT_IDS),
});

/**
 * Server action: switch the current viewer's admin variant.
 *
 * - Always writes the ghc_admin_variant cookie (so anon visitors get persistence
 *   too — though the admin requires login, the cookie is set defensively).
 * - If the request is from a logged-in user, also persists the choice on
 *   `users.admin_variant` so the preference follows them across devices.
 * - Re-renders the layout so the next paint picks up the new data-admin.
 *
 * Returns the new variant on success, or a validation/error state on failure.
 * The AdminVariantSwitcher client component is the only caller.
 */
export async function setAdminVariantAction(
  _prev: SetAdminVariantState,
  formData: FormData,
): Promise<SetAdminVariantState> {
  const raw = formData.get('adminVariant');
  const parsed = Schema.safeParse({ adminVariant: raw });
  if (!parsed.success) {
    return {
      status: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'unknown variant',
    };
  }
  const variant = parsed.data.adminVariant;
  if (!isAdminVariant(variant)) {
    return { status: 'invalid', message: 'unknown variant' };
  }

  // 1. Always set the cookie.
  const cookieStore = await cookies();
  cookieStore.set({
    name: ADMIN_VARIANT_COOKIE,
    value: variant,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: false,
  });

  // 2. If logged in, persist on the user record.
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
        data: { adminVariant: variant },
      });
      logger.info(
        {
          userId: user.id.toString(),
          variant,
          sidPrefix: cookieMap[SESSION_COOKIE_NAME]?.slice(0, 4),
        },
        'admin variant persisted on user',
      );
    }
  } catch (e: unknown) {
    logger.warn({ err: e, variant }, 'failed to persist admin variant on user');
  }

  // 3. Bust caches so the new variant shows up on every route immediately.
  revalidatePath('/', 'layout');

  return { status: 'ok', variant };
}