import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { validateSession } from '@/lib/auth/session';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { verifyCsrf } from '@/lib/auth/csrf';
import { getUserById } from '@/lib/db/users';
import { changePassword } from '@/lib/auth/password-reset';
import { writeAudit } from '@/lib/audit/writer';

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
 *   200 — { ok: true, tempPassword }
 *   400 — invalid id or body
 *   403 — not admin / invalid CSRF
 *   404 — user not found
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
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const target = await getUserById(id);
  if (!target) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return NextResponse.json({ error: 'invalid csrf' }, { status: 403 });
  }

  const tempPassword = generateTempPassword();
  // changePassword already invalidates all sessions + audits password_changed.
  await changePassword(id, tempPassword);

  const fwdReset = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: 'reset_password',
    targetType: 'user',
    targetId: String(id),
    actorUserId: user.id,
    ...(fwdReset !== null && fwdReset !== '' ? { ip: fwdReset } : {}),
  });

  // Return temp password ONCE — admin must communicate it to the user.
  return NextResponse.json({ ok: true, tempPassword });
}
