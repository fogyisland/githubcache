'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ADMIN_MODE_IDS,
  isAdminMode,
  type AdminModeId,
} from '@/lib/admin/mode';
import { ADMIN_MODE_COOKIE } from '@/lib/admin/cookie';
import { logger } from '@/lib/logger';

export interface SetAdminModeState {
  status: 'idle' | 'ok' | 'invalid' | 'error';
  message?: string;
  mode?: AdminModeId;
}

const Schema = z.object({
  adminMode: z.enum(ADMIN_MODE_IDS),
});

/**
 * Server action: switch the admin color mode (light / dark).
 *
 * M26.x — sets the ghc_admin_mode cookie for SSR-to-paint consistency.
 * Unlike the admin variant (which also persists on `users.admin_variant`),
 * the mode is cookie-only for now — it's a per-device visual preference
 * and we don't want to gate it on a DB roundtrip. If cross-device
 * persistence becomes important we can add a column.
 *
 * Re-renders the layout so the next paint picks up the new data-admin-mode.
 */
export async function setAdminModeAction(
  _prev: SetAdminModeState,
  formData: FormData,
): Promise<SetAdminModeState> {
  const raw = formData.get('adminMode');
  const parsed = Schema.safeParse({ adminMode: raw });
  if (!parsed.success) {
    return {
      status: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'unknown mode',
    };
  }
  const mode = parsed.data.adminMode;
  if (!isAdminMode(mode)) {
    return { status: 'invalid', message: 'unknown mode' };
  }

  const cookieStore = await cookies();
  await cookieStore.set({
    name: ADMIN_MODE_COOKIE,
    value: mode,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: false,
  });

  logger.info({ mode }, 'admin mode switched');

  revalidatePath('/', 'layout');

  return { status: 'ok', mode };
}
