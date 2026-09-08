'use server';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '@/lib/auth/password';
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
 * Server action: create (or promote) the bootstrap admin user.
 *
 * M28.bug12: used by /init wizard step 2. The wizard's step 1 wrote a fresh
 * DATABASE_URL to .env via writeSetupEnv, which ALSO updates
 * process.env.DATABASE_URL — but the shared `@/lib/db/client` PrismaClient
 * is constructed once at module-load with whatever DATABASE_URL was at boot.
 * If the server was started with no DATABASE_URL (placeholder / undefined /
 * stale stub from a previous test), the shared client is permanently locked
 * to that URL and step 2 fails with Prisma auth errors.
 *
 * Fix: create a one-shot PrismaClient scoped to this single server action,
 * reading the current process.env.DATABASE_URL. The client connects to the
 * real DB, writes the admin user, then disconnects. The shared client
 * catches up on the next request — by then, the user has restarted the
 * server (or HMR reloaded modules in dev).
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

  /**
 * Read DATABASE_URL directly from .env on disk — NOT from process.env.
 *
 * M28.bug12 follow-up: Next.js dev mode watches .env and re-merges with
 * process.env on each request, with shell-exported values winning over
 * file values. So if the operator started the server with
 * `DATABASE_URL=stub npm run dev`, our writeSetupEnv's update to
 * process.env.DATABASE_URL gets clobbered back to "stub" on the next
 * request by Next.js's env loader. Reading from the file directly
 * bypasses this race.
 *
 * In production (`next start`), Next.js loads .env once at boot and
 * doesn't reload it. process.env would work there but reading from disk
 * is consistent across dev/prod and only costs one fs read.
 */
function readDbUrlFromEnv(): string | null {
  const envPath = join(process.cwd(), '.env');
  try {
    const content = readFileSync(envPath, 'utf8');
    const m = /^DATABASE_URL=(.+)$/m.exec(content);
    return m && m[1] ? m[1].trim() : null;
  } catch {
    return null;
  }
}

  const dbUrl = readDbUrlFromEnv();
  if (!dbUrl) {
    return { ok: false, error: 'DATABASE_URL 未设置——请先完成 /init/db 步骤' };
  }

  // One-shot client — see comment above. Mirrors @/lib/db/client's connection
  // tuning so production behavior matches.
  const oneShot = new PrismaClient({
    datasources: { db: { url: appendConnectionParams(dbUrl) } },
    log: ['error'],
  });

  try {
    const existing = await oneShot.user.findUnique({ where: { email } });
    if (existing) {
      // Promote to admin/active if a user with this email already exists.
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
    return { ok: false, error: `数据库写入失败：${(e as Error).message}` };
  } finally {
    await oneShot.$disconnect().catch(() => undefined);
  }
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