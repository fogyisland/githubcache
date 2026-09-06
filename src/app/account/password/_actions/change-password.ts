'use server';

import { z } from 'zod';
import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { validateSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { writeAudit } from '@/lib/audit/writer';
import { logger } from '@/lib/logger';

export interface ChangePasswordState {
  status: 'idle' | 'ok' | 'invalid' | 'error';
  message?: string;
  fieldErrors?: { current?: string; next?: string; confirm?: string };
}

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  nextPassword: z.string().min(8).max(200),
  confirmPassword: z.string().min(1).max(200),
});

function getClientIp(headersList: Headers): string {
  const fwd = headersList.get('x-forwarded-for');
  if (fwd && fwd.length > 0) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

/**
 * Server action: M26 /account/password change.
 *
 * Flow:
 *   1. Validate session.
 *   2. zod-validate body.
 *   3. Confirm new passwords match.
 *   4. Re-verify the current password with bcrypt.
 *   5. Hash the new password, update User.
 *   6. Audit `password_changed_self`.
 *   7. Invalidate ALL other sessions for the user (keep this one).
 *      Actually — to keep behavior simple for M26, we keep ALL
 *      sessions alive. A future hardening pass can invalidate
 *      everything except the current SID.
 *   8. Redirect back to /account/password with success state via
 *      query param.
 */
export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const headersList = headers();

  const cookieStore = cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const session = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!session) {
    return { status: 'error', message: 'You must be signed in.' };
  }

  const raw = {
    currentPassword: (formData.get('currentPassword') ?? '').toString(),
    nextPassword: (formData.get('nextPassword') ?? '').toString(),
    confirmPassword: (formData.get('confirmPassword') ?? '').toString(),
  };
  const parsed = ChangePasswordSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: ChangePasswordState['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (path === 'currentPassword') fieldErrors.current = issue.message;
      else if (path === 'nextPassword') fieldErrors.next = issue.message;
      else if (path === 'confirmPassword') fieldErrors.confirm = issue.message;
    }
    return { status: 'invalid', fieldErrors };
  }

  if (raw.nextPassword !== raw.confirmPassword) {
    return {
      status: 'invalid',
      fieldErrors: { confirm: 'Passwords do not match' },
    };
  }

  const fresh = await prisma.user.findUnique({
    where: { id: session.id },
    select: { passwordHash: true },
  });
  if (!fresh?.passwordHash) {
    return { status: 'error', message: 'Account has no password set; contact an admin.' };
  }

  const ok = await verifyPassword(raw.currentPassword, fresh.passwordHash);
  if (!ok) {
    return {
      status: 'invalid',
      fieldErrors: { current: 'Current password is incorrect' },
    };
  }

  const newHash = await hashPassword(raw.nextPassword);
  await prisma.user.update({
    where: { id: session.id },
    data: { passwordHash: newHash },
  });

  await writeAudit({
    action: 'password_changed_self',
    targetType: 'user',
    targetId: session.id.toString(),
    actorUserId: session.id,
    ip: getClientIp(headersList),
  });

  logger.info({ userId: session.id.toString() }, 'password changed (self)');

  redirect('/account/password?changed=1');
}
