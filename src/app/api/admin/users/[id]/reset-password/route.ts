import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { validateSession } from '@/lib/auth/session';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { verifyCsrf } from '@/lib/auth/csrf';
import { getUserById } from '@/lib/db/users';
import { changePassword } from '@/lib/auth/password-reset';
import { writeAudit } from '@/lib/audit/writer';
import { apiError } from '@/lib/api/errors';
import { sendPasswordResetEmail } from '@/lib/email/triggers/password-reset';
import { logger } from '@/lib/logger';

const Body = z.object({ csrf: z.string().min(1) });

/**
 * Generate a 16-character base64url temporary password.
 *
 * 16 chars produced from 12 random bytes (base64url encodes 3 bytes
 * as 4 chars, so 12 bytes → 16 chars exactly — no slicing needed).
 * Displayed to the admin ONCE; the hash is stored and the plaintext
 * is never recoverable later.
 */
function generateTempPassword(): string {
  return randomBytes(12).toString('base64url');
}

/**
 * POST /api/admin/users/[id]/reset-password
 *
 * Admin-only. Generates a temporary password, calls `changePassword` (which
 * also invalidates ALL sessions for the user — M6.7 §8.5 contract), and
 * returns the temp password in the response.
 *
 * The admin is responsible for communicating the temp password to the
 * user (in person, Slack, etc.) — this project has no email sender.
 *
 * Response codes:
 *   200 — { ok: true, tempPassword, emailSent }
 *   400 — invalid id or body
 *   403 — not admin / invalid CSRF
 *   404 — user not found
 *
 * M25: when SMTP is configured, the temp password is also emailed
 * to the user. `emailSent` in the response reflects the outcome —
 * the response body still includes `tempPassword` so the admin can
 * always copy it out of band even if SMTP failed.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  // Admin only
  const user = await validateSession({
    headers: req.headers,
    cookies: cookiesFromRequest(req),
  });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'forbidden', {}, req);
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return apiError('bad_request', 'invalid id', {}, req);
  }
  const target = await getUserById(id);
  if (!target) {
    return apiError('not_found', 'not found', {}, req);
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return apiError('bad_request', 'invalid body', {}, req);
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return apiError('forbidden', 'invalid csrf', {}, req);
  }

  const tempPassword = generateTempPassword();
  // changePassword already invalidates all sessions + audits password_changed.
  // Pass `user.id` (the admin) as the audit actor — the audit should reflect
  // who performed the reset, not the user whose password was changed.
  await changePassword(id, tempPassword, user.id);

  const fwdReset = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: 'reset_password',
    targetType: 'user',
    targetId: String(id),
    actorUserId: user.id,
    ...(fwdReset !== null && fwdReset !== '' ? { ip: fwdReset } : {}),
  });

  // M25 — also email the temp password when SMTP is configured.
  let emailSent = false;
  try {
    const origin = req.headers.get('origin') ?? new URL(req.url).origin;
    const sendResult = await sendPasswordResetEmail(target, tempPassword, origin);
    emailSent = sendResult.ok;
    if (!sendResult.ok) {
      logger.info(
        { userId: String(id), error: sendResult.error },
        'password-reset email not sent (likely not_configured)',
      );
    }
  } catch (e: unknown) {
    logger.error({ err: e, userId: String(id) }, 'password-reset email send threw');
  }

  // Return temp password ONCE — admin must communicate it to the user.
  return NextResponse.json({ ok: true, tempPassword, emailSent });
}
