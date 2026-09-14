import { NextResponse } from 'next/server';
import { getSetupStatus } from '@/lib/init/setup-status';

export const dynamic = 'force-dynamic';

/**
 * GET /api/setup/status — M32.6.
 *
 * Tiny public endpoint that reports whether the DB looks like a
 * fully-bootstrapped install. The wizard writes a user with
 * role='admin' in step 3; this route counts those rows.
 *
 * This endpoint is intentionally NOT gated by the setup gate (the
 * middleware matcher excludes `/api/setup/status`) — otherwise the
 * middleware would loop trying to fetch it.
 *
 * Side effect — when `done=true`, we also stamp `ghc_setup_done=1`
 * on the response. This is the backfill path for environments that
 * were initialized before M32.6 (or whose browser cookie was lost):
 * calling this endpoint once self-heals the missing cookie so the
 * user doesn't get bounced back to /init on every request.
 *
 * Returns: `{done: boolean, reason: 'admin_present' | 'no_admin_user'}`.
 */
export async function GET(): Promise<Response> {
  const status = await getSetupStatus();
  const res = NextResponse.json(status, {
    headers: {
      'cache-control': 'private, max-age=5',
    },
  });
  if (status.done) {
    // 10-year cookie matching the wizard's lockSetupSubtask.
    res.cookies.set({
      name: 'ghc_setup_done',
      value: '1',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365 * 10,
    });
  }
  return res;
}
