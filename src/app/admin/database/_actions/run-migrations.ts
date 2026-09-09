'use server';

import { spawnSync } from 'node:child_process';
import { redirect } from 'next/navigation';
import { logger } from '@/lib/logger';

export interface RunMigrationsResult {
  ok: boolean;
  applied: number;
  error?: string;
  output?: string;
}

/**
 * Run `prisma migrate deploy` on demand from the admin UI.
 *
 * Idempotent — safe to re-run; only applies new migrations.
 * shell:true for Windows npx.cmd resolution.
 */
export async function runMigrationsAction(): Promise<RunMigrationsResult> {
  const r = spawnSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: process.env,
    shell: true,
  });
  const stdout = (r.stdout ?? Buffer.alloc(0)).toString();
  const stderr = (r.stderr ?? Buffer.alloc(0)).toString();
  if (r.status !== 0) {
    logger.error({ exit: r.status, stdout, stderr }, 'admin: migrate deploy failed');
    return { ok: false, applied: 0, error: (stderr || stdout).slice(-2000) || 'migrate deploy failed' };
  }

  // Count how many migrations the deploy said it applied, for the toast.
  // "1 migration(s) added" or "No pending migrations to apply."
  const match = stdout.match(/(\d+)\s+migration\(s\)\s+added/);
  const applied = match ? Number(match[1]) : 0;
  logger.info({ applied }, 'admin: migrate deploy ok');
  return { ok: true, applied, output: stdout };
}

/**
 * Convenience: run + redirect to /admin/database so the server component
 * re-renders with fresh status. Used as a Server Action button target.
 */
export async function runMigrationsAndRedirect(): Promise<never> {
  await runMigrationsAction();
  redirect('/admin/database');
}