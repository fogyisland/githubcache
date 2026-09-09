'use server';

import { readFileSync } from 'node:fs';
import { cookies } from 'next/headers';
import { PrismaClient } from '@prisma/client';
import { redirect } from 'next/navigation';
import { ENV_PATH } from '@/lib/setup';
import { ensureFreshSchemaWith } from '@/lib/db/init-schema';
import { readAdminStash, clearAdminStash } from './submit-admin-config';
import { logger } from '@/lib/logger';

/**
 * Step 3 wizard actions — M28.bug17 split into per-subtask server actions
 * so the /init/execute page can show a live checklist.
 *
 * M28.bug24 (rewritten) — first-time setup uses pure CREATE TABLE IF NOT
 * EXISTS statements via `@/lib/db/init-schema`, NOT `prisma db push`. db
 * push requires SUPER privileges and triggers/foreign-key probing, which
 * standard managed MySQL (PlanetScale, 阿里云 RDS, Aurora) deny — it
 * fails with P3018 / error 1419. The new path runs as a plain
 * `$executeRawUnsafe` per CREATE TABLE statement, no SUPER, no
 * subprocess, idempotent on re-run.
 *
 * Each returns a discriminated union `{ ok, error? }`. The client chains
 * them in order and updates a checklist UI as each completes. If any step
 * fails, the next one is not invoked; the user sees the error and can
 * retry the same step (idempotent — CREATE TABLE IF NOT EXISTS is a
 * no-op on existing tables, upsert admin + set cookie are safe to re-run).
 */

export interface SubtaskResult {
  ok: boolean;
  error?: string;
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

/** Read DATABASE_URL from .env. Shared by all three subtasks. */
function readDbUrl(): { ok: true; dbUrl: string } | { ok: false; error: string } {
  let content: string;
  try {
    content = readFileSync(ENV_PATH, 'utf8');
  } catch {
    return { ok: false, error: '.env 不存在 — 请先完成 /init/db 步骤' };
  }
  const m = /^DATABASE_URL=(.+)$/m.exec(content);
  if (!m || !m[1]) {
    return { ok: false, error: '.env 缺少 DATABASE_URL' };
  }
  return { ok: true, dbUrl: m[1].trim() };
}

/**
 * Subtask 1: create the schema + seed `_prisma_migrations`.
 *
 * The actual DDL lives in `@/lib/db/init-schema` so the wizard, the
 * CLI script, and any future operator tool all use the same source of
 * truth. We use a one-shot PrismaClient (not the shared lazy client) so
 * the wizard runs before the env-merge dance that initialises the
 * shared instance — see M28.bug14 for the historical context.
 */
export async function runMigrateSubtask(): Promise<SubtaskResult> {
  const url = readDbUrl();
  if (!url.ok) return url;

  const oneShot = new PrismaClient({
    datasources: { db: { url: appendConnectionParams(url.dbUrl) } },
    log: ['error'],
  });
  try {
    const result = await ensureFreshSchemaWith(oneShot);
    logger.info(
      {
        alreadyInitialized: result.alreadyInitialized,
        createdTables: result.createdTables,
        markedMigrations: result.markedMigrations,
      },
      'init: ensureFreshSchema ok',
    );
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    logger.error({ err: msg }, 'init: ensureFreshSchema failed');
    return { ok: false, error: msg };
  } finally {
    await oneShot.$disconnect().catch(() => undefined);
  }
}

/**
 * Subtask 2: create / promote the admin user.
 *
 * Reads the stash cookie written by submitAdminConfig (set in step 2).
 * Idempotent: upserts by email — if user exists, just resets role/active/
 * passwordHash. Uses one-shot PrismaClient because the shared client was
 * instantiated at server boot, possibly with a different DATABASE_URL.
 */
export async function createAdminSubtask(): Promise<SubtaskResult> {
  const url = readDbUrl();
  if (!url.ok) return url;

  const stash = await readAdminStash();
  if (!stash) {
    return {
      ok: false,
      error: '管理员 cookie 缺失或已过期（10 分钟）— 请重新填写 /init/admin',
    };
  }
  const { email, passwordHash } = stash;

  const oneShot = new PrismaClient({
    datasources: { db: { url: appendConnectionParams(url.dbUrl) } },
    log: ['error'],
  });
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
    return { ok: true };
  } catch (e) {
    logger.error({ err: (e as Error).message, email }, 'init: admin upsert failed');
    return { ok: false, error: (e as Error).message };
  } finally {
    await oneShot.$disconnect().catch(() => undefined);
  }
}

/**
 * Subtask 3: lock the wizard — clear stash cookie, set ghc_setup_done cookie,
 * redirect to /login.
 *
 * Idempotent: re-setting ghc_setup_done just refreshes the cookie's expiry.
 */
export async function lockSetupSubtask(): Promise<SubtaskResult> {
  await clearAdminStash();
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

/**
 * Convenience: run all three subtasks atomically. Still exported so legacy
 * callers (tests, future one-shot admin tools) can use it without the
 * checklist UX.
 */
export async function finalizeSetup(): Promise<SubtaskResult> {
  for (const step of [runMigrateSubtask, createAdminSubtask, lockSetupSubtask]) {
    const r = await step();
    if (!r.ok) return r;
  }
  return { ok: true };
}

export async function finalizeSetupAndRedirect(): Promise<never> {
  const r = await finalizeSetup();
  if (!r.ok) {
    redirect(`/init/execute?error=${encodeURIComponent(r.error ?? '')}`);
  }
  redirect('/login');
}