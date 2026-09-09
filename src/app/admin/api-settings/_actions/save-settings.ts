'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { TUNABLE_KEYS, writeTunables, type SettingsUpdate } from '@/lib/config/settings-store';

const ALLOWED = new Set<string>(TUNABLE_KEYS);

const NumericKey = z.enum(TUNABLE_KEYS as unknown as [string, ...string[]]);

const Payload = z.object({
  updates: z
    .array(
      z.object({
        key: NumericKey,
        value: z.union([z.coerce.number().int().min(0), z.boolean(), z.string().min(1)]),
      }),
    )
    .min(1)
    .max(50),
});

export interface SaveApiSettingsState {
  status: 'idle' | 'ok' | 'error';
  message?: string;
  applied?: number;
  changed?: string[];
  /** Hint to the UI that process restart is required for the
   *  new values to take effect in the long-running scheduler / pool. */
  needsRestart?: boolean;
}

/**
 * Server action — persist a batch of API-setting changes to .env.
 *
 * Validates the key against the allow-list (defense in depth so
 * a crafty client can't ask us to write DATABASE_URL or
 * SESSION_SECRET) and the value type (positive int / boolean /
 * non-empty string). Returns a state object the form can render
 * without re-rendering the whole page.
 */
export async function saveApiSettings(
  _prev: SaveApiSettingsState,
  formData: FormData,
): Promise<SaveApiSettingsState> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('payload') ?? '{}'));
  } catch {
    return { status: 'error', message: 'invalid payload' };
  }
  const parsed = Payload.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues.map((i) => i.message).join('; '),
    };
  }
  // Defense in depth — Payload already restricts key to TUNABLE_KEYS,
  // but explicit allow-list check makes the contract obvious. The
  // `as TunableKey` is safe because ALLOWED.has() is checked first.
  const updates: SettingsUpdate[] = parsed.data.updates
    .filter((u): u is SettingsUpdate => ALLOWED.has(u.key));
  if (updates.length === 0) {
    return { status: 'error', message: 'no valid keys in payload' };
  }
  const result = writeTunables(updates);
  if (!result.ok) {
    logger.error({ result }, 'admin: save api settings failed');
    return { status: 'error', message: result.error ?? 'write failed' };
  }
  logger.info({ applied: result.applied, changed: result.changed }, 'admin: api settings saved');
  // Invalidate the admin cache so the page re-reads from .env and
  // shows the new values on next render.
  revalidatePath('/admin/api-settings');
  return {
    status: 'ok',
    applied: result.applied,
    changed: result.changed,
    needsRestart: result.applied > 0,
  };
}