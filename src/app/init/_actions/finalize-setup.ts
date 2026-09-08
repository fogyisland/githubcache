'use server';

import { spawnSync } from 'node:child_process';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { logger } from '@/lib/logger';

export interface FinalizeResult {
  ok: boolean;
  error?: string;
}

/**
 * Server action: runs `npx prisma migrate deploy` then locks the wizard.
 *
 * Order matters — we MUST run migrations BEFORE setting ghc_setup_done.
 * If migrations fail, the cookie is not set and the user can retry /init/execute.
 * If we set the cookie first and migrations fail, the user is locked out of
 * the wizard with a half-built schema (worst case).
 *
 * Shell: true is required on Windows so npx.cmd (a .cmd shim) resolves.
 * Without it, spawnSync returns exit=null with no output (silent failure).
 *
 * M28.bug12: cookie `ghc_setup_done=1`, 10-year Max-Age, Path=/ so every
 * subsequent request passes the middleware gate. Once set, /init/* and
 * /api/init/* become inaccessible — middleware bounces to /.
 */
export async function finalizeSetup(): Promise<FinalizeResult> {
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

  const jar = await cookies();
  jar.set({
    name: 'ghc_setup_done',
    value: '1',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365 * 10, // 10 years
  });
  return { ok: true };
}

/**
 * Server action variant for direct invocation that also redirects.
 * The page route doesn't actually call it — it returns the redirect, which
 * Next.js picks up from the action result and applies to the browser.
 *
 * Exported in case we ever want a "reset and re-init" admin action.
 */
export async function finalizeSetupAndRedirect(): Promise<never> {
  const result = await finalizeSetup();
  if (!result.ok) {
    redirect(`/init/execute?error=${encodeURIComponent(result.error ?? '')}`);
  }
  redirect('/login');
}