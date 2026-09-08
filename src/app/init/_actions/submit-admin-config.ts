'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { hashPassword } from '@/lib/auth/password';
import { logger } from '@/lib/logger';

const AdminSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

/**
 * Cookie that carries the wizard's stashed admin from step 2 to step 3.
 *
 * M28.bug14: previous flow wrote INIT_ADMIN_EMAIL + INIT_ADMIN_PASSWORD_HASH
 * into .env. User feedback: don't pollute .env with temporary data. The
 * cookie is HTTP-only (JS can't read it), scoped to /init (not sent on
 * regular app requests), and 10-minute max-age so an abandoned wizard
 * self-cleans. finalizeSetup reads + deletes the cookie on success.
 *
 * TLS protects the cookie in transit. The 10-min cap limits the window
 * where an attacker who intercepted the cookie could complete setup as
 * the admin — and step 1's DATABASE_URL write gates the whole flow
 * anyway, so the cookie alone isn't enough.
 */
const ADMIN_STASH_COOKIE = 'ghc_init_admin';

export interface SubmitAdminResult {
  ok: boolean;
  error?: string;
}

export async function submitAdminConfig(input: unknown): Promise<SubmitAdminResult> {
  const parsed = AdminSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const { email, password } = parsed.data;

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'init: bcrypt failed');
    return { ok: false, error: '密码哈希失败' };
  }

  const jar = await cookies();
  jar.set({
    name: ADMIN_STASH_COOKIE,
    value: JSON.stringify({ email, passwordHash }),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/init',
    maxAge: 60 * 10, // 10 minutes — wizard must complete inside this window
  });
  return { ok: true };
}

/**
 * Read the stashed admin from the cookie. Returns null if absent or
 * malformed. finalizeSetup calls this; nobody else needs it.
 */
export async function readAdminStash(): Promise<{ email: string; passwordHash: string } | null> {
  const jar = await cookies();
  const raw = jar.get(ADMIN_STASH_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.email === 'string' &&
      typeof parsed.passwordHash === 'string'
    ) {
      return { email: parsed.email, passwordHash: parsed.passwordHash };
    }
    return null;
  } catch {
    return null;
  }
}

/** Delete the stash cookie. finalizeSetup calls this on success. */
export async function clearAdminStash(): Promise<void> {
  const jar = await cookies();
  jar.delete(ADMIN_STASH_COOKIE);
}