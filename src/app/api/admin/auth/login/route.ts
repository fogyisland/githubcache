import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { issueCsrfToken, setCsrfCookie, verifyCsrf } from '@/lib/auth/csrf';
import { recordLoginAttempt, resetLoginThrottle } from '@/lib/rate-limit/login-throttle';
import { prisma } from '@/lib/db/client';
import { writeAudit } from '@/lib/audit/writer';
import { logger } from '@/lib/logger';

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
  csrf: z.string().min(1).max(128),
});

/**
 * POST /api/admin/auth/login
 *
 * Body: { email, password, csrf }
 *
 * Flow:
 *   1. Verify CSRF (defense in depth — middleware also checks, but routes are
 *      a critical boundary and should not rely on middleware alone)
 *   2. Extract client IP for throttle + audit
 *   3. Check login throttle for IP — if blocked, return 429 immediately
 *   4. Parse + validate body
 *   5. Look up user by email
 *   6. Verify password with bcrypt
 *   7. On failure: audit `login_failed`, return 401
 *   8. On success:
 *      - Update user.lastLoginAt
 *      - Reset IP throttle (correct-password users shouldn't carry a counter)
 *      - Create session, set session cookie
 *      - Issue + rotate CSRF token (per OWASP CSRF cheatsheet — rotate on login)
 *      - Audit `login_success`
 *      - Return 200 with role
 *
 * Response codes:
 *   200 — success
 *   400 — invalid body
 *   401 — bad credentials (email not found OR password wrong — generic message
 *         to prevent email enumeration)
 *   403 — CSRF invalid OR user disabled
 *   429 — IP throttled (Retry-After header set)
 */
export async function POST(req: Request): Promise<Response> {
  // 1. CSRF check (defense in depth)
  const headerToken = req.headers.get('x-csrf-token');
  if (!verifyCsrf(req, headerToken)) {
    return NextResponse.json({ error: 'csrf' }, { status: 403 });
  }

  // 2. Extract IP
  const fwd = req.headers.get('x-forwarded-for');
  const ip = fwd?.split(',')[0]?.trim() || 'unknown';

  // 3. Throttle check (BEFORE body parse to avoid resource amplification)
  const throttle = recordLoginAttempt(ip);
  if (!throttle.allowed) {
    void writeAudit({
      action: 'login_throttled',
      targetType: 'ip',
      targetId: ip,
      metadata: { attempts: throttle.attempts, retryAfterSec: throttle.retryAfterSec },
      ip,
    });
    return NextResponse.json(
      { error: 'too_many_attempts' },
      {
        status: 429,
        headers: { 'Retry-After': String(throttle.retryAfterSec) },
      },
    );
  }

  // 4. Parse body
  let body: z.infer<typeof loginSchema>;
  try {
    const raw: unknown = await req.json();
    body = loginSchema.parse(raw);
  } catch (e: unknown) {
    logger.warn({ err: e, ip }, 'login: invalid body');
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // 5-6. Look up user + verify password
  const user = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true, passwordHash: true, role: true, status: true },
  });

  // Generic "invalid credentials" message — don't reveal whether email exists
  const invalidCredentials = (): Response =>
    NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });

  if (!user || !user.passwordHash) {
    void writeAudit({
      action: 'login_failed',
      targetType: 'user',
      targetId: user?.id ? String(user.id) : body.email, // log email if user not found, else user id
      metadata: { reason: 'no_user_or_no_password', email: body.email },
      ip,
    });
    return invalidCredentials();
  }

  const passwordOk = await verifyPassword(body.password, user.passwordHash);
  if (!passwordOk) {
    void writeAudit({
      action: 'login_failed',
      targetType: 'user',
      targetId: String(user.id),
      metadata: { reason: 'wrong_password', email: body.email },
      ip,
    });
    return invalidCredentials();
  }

  // 7. User status check (password OK but disabled)
  if (user.status !== 'active') {
    void writeAudit({
      action: 'login_failed',
      targetType: 'user',
      targetId: String(user.id),
      metadata: { reason: 'disabled', status: user.status },
      ip,
    });
    return NextResponse.json({ error: 'account_disabled' }, { status: 403 });
  }

  // 8. Success
  await Promise.all([
    // Update lastLoginAt (awaited — useful for "recently active" admin queries)
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }),
    // Audit success (awaited — we want this durable before responding)
    writeAudit({
      action: 'login_success',
      targetType: 'user',
      targetId: String(user.id),
      ip,
    }),
  ]);

  // Reset IP throttle — correct-password user shouldn't carry a counter
  resetLoginThrottle(ip);

  // Create session + cookies
  const res = NextResponse.json({ ok: true, role: user.role });
  await createSession(user.id, res, ip);
  // Rotate CSRF token on login (OWASP best practice — prevents fixation)
  const csrfToken = issueCsrfToken();
  setCsrfCookie(res, csrfToken);

  return res;
}
