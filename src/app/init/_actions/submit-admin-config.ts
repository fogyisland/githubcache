'use server';

import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { hashPassword } from '@/lib/auth/password';
import { ENV_PATH, upsertEnvLine } from '@/lib/setup';
import { logger } from '@/lib/logger';

const AdminSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export interface SubmitAdminResult {
  ok: boolean;
  error?: string;
}

/**
 * Server action: stash the bootstrap admin email + bcrypt hash in .env.
 *
 * M28.bug13: this step NO LONGER writes to the database. The user's flow is:
 *   step 1 — write DATABASE_URL to .env
 *   step 2 — stash admin email + password hash in .env temp keys (THIS fn)
 *   step 3 — run prisma migrate deploy, then read the stashed values back
 *            and create the user, then strip the temp keys from .env
 *
 * Why: step 2 previously called prisma.user.create(), which requires the
 * schema to already exist. The schema is created by step 3's migrate
 * deploy — a chicken-and-egg that fails on a fresh DB. Stashing in .env
 * sidesteps the ordering entirely.
 *
 * The temp keys (INIT_ADMIN_EMAIL, INIT_ADMIN_PASSWORD_HASH) are removed
 * by finalizeSetup once the user is created. If finalizeSetup never
 * runs, an init-restart picks them up — same as the CLI init.ts flow.
 */
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

  // Write to .env so the wizard's step 3 (finalizeSetup) can read them
  // back. ENV_PATH comes from @/lib/setup so we don't drift on path casing.
  let content: string;
  try {
    content = readFileSync(ENV_PATH, 'utf8');
  } catch {
    return {
      ok: false,
      error: '.env 不存在——请先完成 /init/db 步骤写入 DATABASE_URL',
    };
  }
  content = upsertEnvLine(content, 'INIT_ADMIN_EMAIL', email);
  content = upsertEnvLine(content, 'INIT_ADMIN_PASSWORD_HASH', passwordHash);
  try {
    writeFileSync(ENV_PATH, content);
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'init: stash admin in .env failed');
    return { ok: false, error: `写入 .env 失败：${(e as Error).message}` };
  }
  return { ok: true };
}