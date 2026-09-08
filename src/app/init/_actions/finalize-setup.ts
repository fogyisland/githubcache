'use server';

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cookies } from 'next/headers';
import { PrismaClient } from '@prisma/client';
import { redirect } from 'next/navigation';
import { ENV_PATH } from '@/lib/setup';
import { readAdminStash, clearAdminStash } from './submit-admin-config';
import { logger } from '@/lib/logger';

export interface FinalizeResult {
  ok: boolean;
  error?: string;
}

/**
 * Server action: run prisma migrate deploy, then create the bootstrap admin
 * from the stashed email + bcrypt hash (held in the ghc_init_admin cookie
 * set by step 2), then delete that cookie, then set ghc_setup_done=1.
 *
 * M28.bug14 ordering: this is the only step that touches the database.
 * Cookie stash in step 2 keeps step 2 free of any DB schema dependency
 * AND keeps .env clean of temporary keys.
 *
 * Process:
 *   1. spawnSync 'npx prisma migrate deploy' (creates all tables)
 *   2. read ghc_init_admin cookie for { email, passwordHash }
 *   3. one-shot PrismaClient with the URL from .env (NOT process.env —
 *      Next.js dev mode clobbers process.env with shell values per request)
 *   4. upsert the user with role=admin, status=active
 *   5. delete the stash cookie
 *   6. set ghc_setup_done cookie (10y) → middleware locks /init from now on
 */
export async function finalizeSetup(): Promise<FinalizeResult> {
  // --- 1. read DATABASE_URL from .env BEFORE spawning migrate ---------
  // Reason: spawnSync inherits process.env, which carries the .env.production
  // stub DATABASE_URL (mysql://stub:stub@stub.invalid:3306/stub). Without
  // override, prisma migrate deploy would try to connect to that and fail.
  // Override DATABASE_URL via env so the child prisma process uses the
  // URL the operator typed in step 1, not the build-time stub.
  let envContent: string;
  try {
    envContent = readFileSync(ENV_PATH, 'utf8');
  } catch {
    return { ok: false, error: '.env 不存在 — 请先完成 /init/db 步骤' };
  }
  const dbMatch = /^DATABASE_URL=(.+)$/m.exec(envContent);
  if (!dbMatch || !dbMatch[1]) {
    return { ok: false, error: '.env 缺少 DATABASE_URL' };
  }
  const dbUrl = dbMatch[1].trim();

  const stash = await readAdminStash();
  if (!stash) {
    return {
      ok: false,
      error: '管理员 cookie 缺失或已过期（10 分钟）— 请重新填写 /init/admin',
    };
  }
  const { email, passwordHash } = stash;

  // --- 2. prisma migrate deploy (with explicit DATABASE_URL override) --
  const result = spawnSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: dbUrl },
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

  // --- 5. clear the stash cookie ---------------------------------------
  await clearAdminStash();

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