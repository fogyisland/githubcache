import { NextResponse } from 'next/server';
import { validateSession } from '@/lib/auth/session';
import { writeAudit } from '@/lib/audit/writer';
import { apiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { UserStatus } from '@/lib/db/users';

/** Required phrase — case-sensitive, exact. Protects against misclicks. */
const CONFIRM_PHRASE = 'restart';

/**
 * POST /api/admin/system/restart
 *
 * Trigger a graceful restart of the current Next.js process. Designed for
 * the API settings page (after the operator changes TUNABLE_KEYS) and the
 * admin restart button on the same panel.
 *
 * The mechanism is "signal ourselves" — this route calls
 * `bootServerHandle.shutdown()` and then schedules `process.exit(0)`. The
 * process manager (pm2 / systemd / 宝塔) is expected to detect the exit
 * and start a fresh process. No external shell-out (no shell injection
 * surface, no dependency on a specific manager binary).
 *
 * Response shape mirrors a typical action endpoint. The actual exit fires
 * asynchronously after the response is flushed, so the client always sees
 * a 200 before the connection drops.
 *
 * Authorization:
 *   - session-authenticated admin (CSRF enforced by middleware)
 *   - body must contain `confirm: "restart"` (exact phrase)
 *
 * Audit:
 *   - writes `restart_server` with the actor user id and request IP
 *   - writes BEFORE the exit so the row is durable even if the
 *     restart fails or the process is killed
 */
export async function POST(req: Request): Promise<Response> {
  const user = await validateSession(req);
  if (!user) {
    // Hide endpoint existence from unauthenticated callers
    return new NextResponse(null, { status: 404 });
  }
  if (user.status !== UserStatus.Active) {
    return apiError('forbidden', 'account_disabled', {}, req);
  }
  if (user.role !== 'admin') {
    // Defense in depth — non-admin role shouldn't reach this route
    // (middleware doesn't enforce role; only the session check above does).
    return apiError('forbidden', 'admin_required', {}, req);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('bad_request', 'invalid JSON body', {}, req);
  }

  const confirmValue =
    typeof body === 'object' && body !== null && 'confirm' in body
      ? (body as { confirm: unknown }).confirm
      : undefined;
  if (confirmValue !== CONFIRM_PHRASE) {
    return apiError(
      'bad_request',
      `confirm phrase must be exactly "${CONFIRM_PHRASE}"`,
      {},
      req,
    );
  }

  const fwd = req.headers.get('x-forwarded-for');
  const ip = fwd !== null && fwd !== '' ? fwd : undefined;

  try {
    await writeAudit({
      ...(user.id !== undefined ? { actorUserId: user.id } : {}),
      action: 'restart_server',
      targetType: 'system',
      targetId: 'process',
      metadata: {
        triggeredBy: 'admin_button',
        nodeVersion: process.version,
        pid: process.pid,
      },
      ...(ip !== undefined ? { ip } : {}),
    });
  } catch (e) {
    // Audit write failed — don't proceed with the restart, the operator
    // would have no record of who pressed the button.
    logger.error({ err: (e as Error).message }, 'restart: audit write failed');
    return apiError('internal_error', 'audit write failed', {}, req);
  }

  // Schedule graceful shutdown AFTER response is flushed. We don't await
  // it — the response must reach the client before the connection drops.
  scheduleGracefulExit();

  return NextResponse.json({
    ok: true,
    restartInitiatedAt: new Date().toISOString(),
    message:
      'Restart scheduled. The process will exit momentarily; the process ' +
      'manager (pm2 / systemd / 宝塔) is expected to restart it. ' +
      'Verify with GET /api/v1/status — `version.startedAt` should be ' +
      'later than the value before this call.',
  });
}

/**
 * Kick off the graceful shutdown on the next tick so the response can
 * flush first. We can't import `@/server.ts` directly here because that
 * would create a circular dep (server.ts imports route modules).
 *
 * Strategy: send SIGTERM to ourselves. The existing signal handler in
 * src/bootstrap.ts (and src/server.ts dev block) intercepts it and runs
 * the same `bootServerHandle.shutdown()` followed by `process.exit(0)`.
 *
 * If no signal handler is installed (e.g. running under a test harness),
 * process.kill() throws ESRCH and we log instead of crashing the test.
 */
function scheduleGracefulExit(): void {
  setImmediate(() => {
    try {
      // Tests inject a custom exit function via globalThis to avoid
      // killing the vitest worker process.
      const customExit = (globalThis as { __GHC_RESTART_EXIT__?: () => void })
        .__GHC_RESTART_EXIT__;
      if (customExit) {
        customExit();
        return;
      }
      process.kill(process.pid, 'SIGTERM');
    } catch (e) {
      logger.error(
        { err: (e as Error).message },
        'restart: failed to send SIGTERM — process likely already exiting',
      );
    }
  });
}