'use server';

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cookies } from 'next/headers';
import { PrismaClient } from '@prisma/client';
import { redirect } from 'next/navigation';
import { ENV_PATH } from '@/lib/setup';
import { logger } from '@/lib/logger';

export interface FinalizeResult {
  ok: boolean;
  error?: string;
}

/**
 * Server action: run prisma migrate deploy, then create the bootstrap admin
 * from the stashed INIT_ADMIN_EMAIL + INIT_ADMIN_PASSWORD_HASH keys, then
 * strip those temp keys from .env, then set ghc_setup_done=1 cookie.
 *
 * M28.bug13 ordering: this is the only step that touches the database.
 * Stash-in-step-2 keeps step 2 free of any DB schema dependency.
 *
 * Process:
 *   1. spawnSync 'npx prisma migrate deploy' (creates all tables; shell:true
 *      for Windows npx.cmd resolution)
 *   2. read INIT_ADMIN_EMAIL + INIT_ADMIN_PASSWORD_HASH from .env
 *   3. one-shot PrismaClient with the URL from .env (NOT process.env —
 *      Next.js dev mode clobbers process.env with shell values per request)
 *   4. upsert the user with role=admin, status=active
 *   5. strip the two stash keys from .env so they don't linger forever
 *   6. set ghc_setup_done cookie (10y) → middleware locks /init from now on
 */
export async function finalizeSetup(): Promise<FinalizeResult> {
  // --- 1. prisma migrate deploy -----------------------------------------
  const result = spawnSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: process.env,
    shell: true,
  });
  if (result.status !== 0) {
    const stdout = (result.stdout ?? Buffer.alloc(0)).toString();
    const stderr = (result.stderr ?? Buffer.alloc(0)).toString();
    const detail = (stderr || stdout).slice(-2000) || 'prisma migrate deploy 失败';
    logger.error(
      { exit: result.status, stdout, stderr },
      'init: prisma migrate deploy failed',
    );
    return { ok: false, error: detail };
  }

  // --- 2. read stashed admin from .env ----------------------------------
  let envContent: string;
  try {
    envContent = readFileSync(ENV_PATH, 'utf8');
  } catch {
    return { ok: false, error: '.env 不存在 — 请先完成 /init/db 步骤' };
  }
  const dbMatch = /^DATABASE_URL=(.+)$/m.exec(envContent);
  const emailMatch = /^INIT_ADMIN_EMAIL=(.+)$/m.exec(envContent);
  const hashMatch = /^INIT_ADMIN_PASSWORD_HASH=(.+)$/m.exec(envContent);
  if (!dbMatch || !dbMatch[1]) {
    return { ok: false, error: '.env 缺少 DATABASE_URL' };
  }
  if (!emailMatch || !emailMatch[1] || !hashMatch || !hashMatch[1]) {
    return {
      ok: false,
      error: '.env 缺少 INIT_ADMIN_EMAIL / INIT_ADMIN_PASSWORD_HASH — 请先完成 /init/admin 步骤',
    };
  }
  const dbUrl = dbMatch[1].trim();
  const email = emailMatch[1].trim();
  const passwordHash = hashMatch[1].trim();

  // --- 3. one-shot prisma client (see submit-admin-config note for why
  //        we don't share @/lib/db/client — same env-merge race in dev mode)
  const oneShot = new PrismaClient({
    datasources: { db: { url: appendConnectionParams(dbUrl) } },
    log: ['error'],
  });

  // --- 4. create / promote admin user -----------------------------------
  try {
    const existing = await oneShot.user.findUnique({ where: { email } });
    if (existing) {
      await oneShot.user.update({
        where: { id: existing.id },
        data: { passwordHash, role: 'admin', status: 'active' },
      });
    } else {
      await oneShot.user.create({
        data: {
          email,
          passwordHash,
          role: 'admin',
          status: 'active',
          theme: 'terminal',
          adminVariant: 'mission_control',
          lang: 'zh',
        },
      });
    }
  } catch (e) {
    logger.error({ err: (e as Error).message, email }, 'init: admin upsert failed');
    await oneShot.$disconnect().catch(() => undefined);
    return { ok: false, error: `创建管理员失败：${(e as Error).message}` };
  }
  await oneShot.$disconnect().catch(() => undefined);

  // --- 5. strip stash keys from .env ------------------------------------
  let updated = envContent;
  updated = updated.replace(/^INIT_ADMIN_EMAIL=.*\r?\n/m, '');
  updated = updated.replace(/^INIT_ADMIN_PASSWORD_HASH=.*\r?\n/m, '');
  try {
    writeFileSync(ENV_PATH, updated);
  } catch (e) {
    // Non-fatal: leaving the keys doesn't break anything, just leaves a
    // password hash on disk. Surface a warning.
    logger.warn({ err: (e as Error).message }, 'init: failed to strip stash keys');
  }

  // --- 6. lock the wizard via cookie ------------------------------------
  const jar = await cookies();
  jar.set({
    name: 'ghc_setup_done',
    value: '1',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365 * 10,
  });
  return { ok: true };
}

/** Append connection_limit + connect_timeout like @/lib/db/client does. */
function appendConnectionParams(raw: string): string {
  try {
    const url = new URL(raw);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '32');
    }
    if (!url.searchParams.has('connect_timeout')) {
      url.searchParams.set('connect_timeout', '30');
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export async function finalizeSetupAndRedirect(): Promise<never> {
  const result = await finalizeSetup();
  if (!result.ok) {
    redirect(`/init/execute?error=${encodeURIComponent(result.error ?? '')}`);
  }
  redirect('/login');
}