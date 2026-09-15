'use server';

import { readFileSync, writeFileSync } from 'node:fs';
import { cookies } from 'next/headers';
import { PrismaClient } from '@prisma/client';
import { redirect } from 'next/navigation';
import { ENV_PATH, upsertEnvLine } from '@/lib/setup';
import { ensureFreshSchemaWith } from '@/lib/db/init-schema';
import { readAdminStash, clearAdminStash } from './submit-admin-config';
import { logger } from '@/lib/logger';
import { UserStatus } from '@/lib/db/users';

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
      // M31.x.b — split so the status flip goes through the
      // users_status_audit shadow trigger. The wizard is a setup-time
      // tool with no logged-in operator, so actor=0 is the honest
      // value for the resulting user_status_changed_shadow audit row.
      await oneShot.user.update({
        where: { id: existing.id },
        data: { passwordHash, role: 'admin' },
      });
      await oneShot.$transaction([
        oneShot.$executeRawUnsafe("SET @app_source = ''"),
        oneShot.$executeRawUnsafe('SET @app_actor = 0'),
        oneShot.user.update({
          where: { id: existing.id },
          data: { status: UserStatus.Active },
        }),
      ]);
    } else {
      await oneShot.user.create({
        data: {
          email,
          passwordHash,
          role: 'admin',
          theme: 'terminal',
          adminVariant: 'mission_control',
          lang: 'zh',
        },
      });
      await oneShot.$transaction([
        oneShot.$executeRawUnsafe("SET @app_source = ''"),
        oneShot.$executeRawUnsafe('SET @app_actor = 0'),
        oneShot.user.update({
          where: { email },
          data: { status: UserStatus.Active },
        }),
      ]);
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
 * Subtask 3: lock the wizard — clear the admin-stash cookie, stamp the
 * long-lived `ghc_setup_done=1` cookie for in-session browsers, AND
 * persist `GHC_SETUP_DONE=1` to .env so a fresh `dev:server` boot
 * picks it up via `process.env` (M32.6.5).
 *
 * The middleware gate reads BOTH signals:
 *   - the cookie (per-browser, fast, works on Edge runtime)
 *   - `process.env.GHC_SETUP_DONE === '1'` (process-wide, durable
 *     across server restarts because `.env` is loaded by Next's
 *     `loadEnvConfig` at boot)
 *
 * Writing to `.env` is the durability fix: without it, every fresh
 * `dev:server` boot would re-bounce to /init because no browser has
 * the cookie yet. With it, init is one-shot — after completion the
 * service runs without the wizard ever being re-entered.
 *
 * Idempotent: re-running refreshes the cookie and re-upserts the
 * .env line (`upsertEnvLine` replaces, doesn't append).
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

  // Persist to .env so a fresh process boot picks the signal up via
  // process.env before the first request hits middleware. Next.js's
  // `loadEnvConfig` runs once per `bootServer()` and merges .env into
  // process.env (verified at node_modules/next/dist/server/base-server.js:320).
  //
  // We write THREE signals in one read-modify-write cycle so the file
  // is touched exactly once and partial failures don't leave the disk
  // state out of sync with the cookie:
  //   - GHC_SETUP_DONE=1            — kills the /init middleware gate
  //   - SCHEDULER_TICK_MS=1000      — drain pending repos at ~1/sec
  //                                    instead of the slow 60s default
  //   - SCHEDULER_BATCH_SIZE=1      — paired with the 1s tick so we
  //                                    process 1 repo per tick (200 OK
  //                                    verified against GitHub)
  try {
    const defaults: Record<string, string> = {
      GHC_SETUP_DONE: '1',
      SCHEDULER_TICK_MS: '1000',
      SCHEDULER_BATCH_SIZE: '1',
    };
    let current = readFileSync(ENV_PATH, 'utf8');
    for (const [key, value] of Object.entries(defaults)) {
      current = upsertEnvLine(current, key, value);
    }
    writeFileSync(ENV_PATH, current);
    // Mirror into process.env so the current process sees the new values
    // without needing a restart. Next.js loadEnvConfig runs at boot, so
    // the on-disk write is what matters for future boots — this just
    // keeps in-process callers (e.g. the scheduler reading
    // process.env.SCHEDULER_TICK_MS after init) consistent.
    for (const [key, value] of Object.entries(defaults)) {
      process.env[key] = value;
    }
    logger.info(
      { keys: Object.keys(defaults) },
      'init: setup defaults persisted to .env (GHC_SETUP_DONE, SCHEDULER_TICK_MS, SCHEDULER_BATCH_SIZE)',
    );
  } catch (e) {
    // .env write failure must NOT block init completion — the cookie
    // signal is sufficient for the current session, and the operator
    // can re-run /init/execute if the file write fails. Surface the
    // error so it shows up in logs but return ok=true.
    logger.error(
      { err: (e as Error).message },
      'init: failed to persist setup defaults to .env; current session still works',
    );
  }

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