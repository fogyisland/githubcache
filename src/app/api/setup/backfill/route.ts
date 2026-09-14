import { NextResponse, type NextRequest } from 'next/server';
import { getSetupStatus } from '@/lib/init/setup-status';

export const dynamic = 'force-dynamic';

/**
 * GET /api/setup/backfill — M32.6.
 *
 * Self-heal endpoint for environments that were initialized before the
 * ghc_setup_done cookie was reliably written, or where the browser
 * cookie was lost (cleared, expired, fresh device). The /init server
 * component redirects here when it detects `status.done=true` but the
 * request is missing the cookie.
 *
 * Route handlers are allowed to mutate cookies via `res.cookies.set`
 * (server components are not — Next.js throws "Cookies can only be
 * modified in a Server Action or Route Handler"). We stamp the
 * 10-year cookie and 308 to the application root so the browser
 * comes back through middleware with the cookie present.
 *
 * If `status.done=false` (DB still has no admin user — fresh deploy),
 * we redirect to /init/db to land the user in the wizard.
 *
 * Host resolution: in dev with a custom server, Next.js's
 * `req.nextUrl.origin` defaults to `http://localhost:3000` regardless of
 * what port `src/server.ts` actually listens on. We fall back to the
 * `Host` header so the redirect lands back on the port the user typed.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const status = await getSetupStatus();
  const targetPath = status.done ? '/' : '/init/db';
  const target = resolveTarget(req, targetPath);

  if (status.done) {
    const res = NextResponse.redirect(target, { status: 308 });
    res.cookies.set({
      name: 'ghc_setup_done',
      value: '1',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365 * 10,
    });
    return res;
  }
  return NextResponse.redirect(target, { status: 308 });
}

/**
 * Resolve the absolute URL for the redirect target. Trust the inbound
 * `Host` header — that's what the browser actually used and where the
 * user expects to land. `req.nextUrl.origin` in dev with a custom
 * server points at `http://localhost:3000` (Next.js's hard-coded dev
 * default) even when `src/server.ts` listens on :5002, so falling
 * through to it would 404 the user back to a non-running port.
 *
 * `x-forwarded-proto` is honored when present so production deploys
 * behind an HTTPS-terminating reverse proxy still get `https://` in
 * the redirect.
 */
function resolveTarget(req: NextRequest, path: string): URL {
  const hostHeader = req.headers.get('host');
  if (hostHeader) {
    const proto = req.headers.get('x-forwarded-proto') ?? 'http';
    return new URL(path, `${proto}://${hostHeader}`);
  }
  return new URL(path, req.nextUrl.origin);
}