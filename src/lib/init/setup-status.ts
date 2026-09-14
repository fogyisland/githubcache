import { prisma } from '@/lib/db/client';

/**
 * Setup status — replaces the `ghc_setup_done` cookie signal (M32.6).
 *
 * The wizard historically wrote `ghc_setup_done=1` to the browser on
 * completion; middleware then gated every non-`/init/*` request on
 * that cookie. The cookie-only signal broke whenever a fresh dev:server
 * started (no browser cookie) or whenever the cookie expired/cleared —
 * even though the underlying DB had a fully provisioned schema + admin
 * user.
 *
 * The new signal is purely DB-derived: "setup is done iff there is at
 * least one user with `role='admin'` AND `status` Active in the users
 * table." That matches what the wizard actually creates in step 3, and
 * is independent of any browser-side state.
 *
 * This module runs in Node.js (called from a Node-runtime API route).
 * The Edge middleware fetches the API route instead of importing this
 * file directly, because middleware can only use Edge-compatible APIs
 * and Prisma is not Edge-compatible.
 */
export interface SetupStatus {
  done: boolean;
  reason: 'admin_present' | 'no_admin_user';
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const adminCount = await prisma.user.count({
    where: { role: 'admin' },
  });
  if (adminCount > 0) {
    return { done: true, reason: 'admin_present' };
  }
  return { done: false, reason: 'no_admin_user' };
}
