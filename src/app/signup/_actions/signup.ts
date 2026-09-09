'use server';

import { z } from 'zod';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { writeAudit } from '@/lib/audit/writer';
import { sendSignupWelcomeEmail } from '@/lib/email/triggers/signup-welcome';
import { logger } from '@/lib/logger';
import { getSignupRateLimit } from '@/lib/auth/signup-rate';

export interface SignupState {
  status: 'idle' | 'ok' | 'invalid' | 'duplicate' | 'rate_limited' | 'error';
  message?: string;
  fieldErrors?: {
    email?: string;
    password?: string;
    passwordConfirm?: string;
    name?: string;
  };
}

const SignupSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  passwordConfirm: z.string().min(1).max(200),
  name: z.string().max(100).optional(),
});

/**
 * Extract the client IP from the inbound request — same logic as the
 * login route. Falls back to `unknown` so the rate limiter still
 * applies (the bucket just keys on the literal `unknown` and so a real
 * IP, a missing header, and a deliberate spoof all share the same
 * bucket — acceptable for a low-stakes 50000/hr cap).
 */
function getClientIp(headersList: Headers): string {
  const fwd = headersList.get('x-forwarded-for');
  if (fwd && fwd.length > 0) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

/**
 * Read the request origin (scheme + host) for absolute URLs in emails.
 * Prefer `x-forwarded-proto` + `host` so it works behind a reverse
 * proxy; fall back to the literal Origin header; final fallback is
 * an empty string so the email link is relative (which is wrong but
 * won't break the server action).
 */
function getRequestOrigin(headersList: Headers): string {
  const proto = headersList.get('x-forwarded-proto') ?? 'http';
  const host = headersList.get('host');
  if (host) return `${proto}://${host}`;
  const origin = headersList.get('origin');
  return origin ?? '';
}

/**
 * Server action: M26 public /signup.
 *
 * Flow:
 *   1. Rate-limit by IP (10/hr) — protects the signup hot path
 *      from abuse without the login-throttle's tight 5/15min shape.
 *   2. Parse + zod-validate body
 *   3. Check for duplicate email
 *   4. Hash password (bcrypt cost 12)
 *   5. Insert user (role=operator, status=active, signupSource=self)
 *   6. Write audit log (`user_signed_up`)
 *   7. Create session + set cookie
 *   8. Fire signup-welcome email (best-effort)
 *   9. Redirect to /account
 *
 * Returns a state object on validation failure so the form can render
 * inline errors and preserve entered values. On success the function
 * never returns (it throws NEXT_REDIRECT).
 */
export async function signupAction(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const headersList = await headers();
  const ip = getClientIp(headersList);

  // 1. Rate limit per IP (default 50000/hour). We do this before
  //    zod-validate so abuse doesn't get a free parse; the limit is
  //    generous enough that real users won't trip it.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentFromIp = await prisma.auditLog.count({
    where: {
      action: 'user_signed_up',
      ip,
      createdAt: { gte: oneHourAgo },
    },
  });
  if (recentFromIp >= getSignupRateLimit()) {
    return {
      status: 'rate_limited',
      message: 'Too many signup attempts from this IP. Try again later.',
    };
  }

  // 2. Validate
  const raw = {
    email: (formData.get('email') ?? '').toString().trim().toLowerCase(),
    password: (formData.get('password') ?? '').toString(),
    passwordConfirm: (formData.get('passwordConfirm') ?? '').toString(),
    name: (formData.get('name') ?? '').toString().trim(),
  };
  const parsed = SignupSchema.safeParse({
    email: raw.email,
    password: raw.password,
    passwordConfirm: raw.passwordConfirm,
    name: raw.name === '' ? undefined : raw.name,
  });

  if (!parsed.success) {
    const fieldErrors: SignupState['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (path === 'email') fieldErrors.email = issue.message;
      else if (path === 'password') fieldErrors.password = issue.message;
      else if (path === 'passwordConfirm')
        fieldErrors.passwordConfirm = issue.message;
      else if (path === 'name') fieldErrors.name = issue.message;
    }
    // Cross-field check: passwords must match
    if (
      raw.password !== raw.passwordConfirm &&
      !fieldErrors.passwordConfirm
    ) {
      fieldErrors.passwordConfirm = 'Passwords do not match';
    }
    return { status: 'invalid', fieldErrors };
  }

  // 3. Password match (zod parsed but doesn't compare)
  if (raw.password !== raw.passwordConfirm) {
    return {
      status: 'invalid',
      fieldErrors: { passwordConfirm: 'Passwords do not match' },
    };
  }

  // 4. Duplicate email check
  const existing = await prisma.user.findUnique({
    where: { email: raw.email },
    select: { id: true },
  });
  if (existing) {
    return {
      status: 'duplicate',
      fieldErrors: { email: 'An account with this email already exists.' },
    };
  }

  // 5. Hash + insert
  let user;
  try {
    const passwordHash = await hashPassword(raw.password);
    user = await prisma.user.create({
      data: {
        email: raw.email,
        passwordHash,
        role: 'operator',
        status: 'active',
        signupSource: 'self',
        ...(raw.name ? { /* no displayName column yet — preserve in audit */ } : {}),
      },
    });
  } catch (e: unknown) {
    // Race: another concurrent signup inserted the same email between
    // our check and create. The unique constraint surfaces here.
    const msg = e instanceof Error ? e.message : 'unknown';
    logger.warn({ err: e, email: raw.email }, 'signup: insert failed');
    if (msg.includes('Unique constraint') || msg.includes('users_email_key')) {
      return {
        status: 'duplicate',
        fieldErrors: { email: 'An account with this email already exists.' },
      };
    }
    return { status: 'error', message: 'Could not create account. Please try again.' };
  }

  // 6. Audit
  await writeAudit({
    action: 'user_signed_up',
    targetType: 'user',
    targetId: user.id.toString(),
    metadata: {
      email: user.email,
      signupSource: 'self',
      ...(raw.name ? { displayName: raw.name } : {}),
    },
    ip,
  });

  // 7. Create session and set cookie. `createSession` writes to the DB
  //    and appends a Set-Cookie to the carrier's headers. We capture
  //    those into a Headers object and forward them onto the request's
  //    `cookies()` store so the cookie lands on the response that
  //    follows our `redirect()`.
  const responseHeaders = new Headers();
  await createSession(user.id, { headers: responseHeaders }, ip);
  const cookieStore = await cookies();
  for (const [name, value] of Object.entries(extractSetCookies(responseHeaders))) {
    cookieStore.set({
      name,
      value,
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      ...(process.env.NODE_ENV === 'production' ? { secure: true } : {}),
    });
  }

  // 8. Welcome email (best-effort — failure does not block signup)
  try {
    const origin = getRequestOrigin(headersList);
    await sendSignupWelcomeEmail({ user, origin });
  } catch (e: unknown) {
    logger.warn({ err: e, userId: user.id.toString() }, 'signup: welcome email failed');
  }

  // 9. Redirect to /account
  redirect('/account');
}

/**
 * Parse Set-Cookie header lines from a Headers carrier so we can
 * forward them onto the request cookie store before redirecting.
 */
function extractSetCookies(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = headers.getSetCookie ? headers.getSetCookie() : [];
  for (const line of raw) {
    const [pair] = line.split(';');
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}
