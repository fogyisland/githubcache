import type { User } from '@prisma/client';
import { passwordResetTemplate } from '@/lib/email/templates/password-reset';
import { sendEmail } from '@/lib/email/sender';
import type { SendEmailResult } from '@/lib/email/sender';

/**
 * M25 — password reset email trigger.
 *
 * Called by POST /api/admin/users/[id]/reset-password after the
 * temp password is generated and `changePassword` has run. The
 * temp password is shown to the user in the email body — never
 * log it server-side.
 *
 * `origin` is the public URL prefix for the login page (e.g.
 * "https://cache.example.com"); embedded in the email so the user
 * can click straight to the sign-in form.
 */
export async function sendPasswordResetEmail(
  user: User,
  tempPassword: string,
  origin: string,
): Promise<SendEmailResult> {
  const loginUrl = `${origin.replace(/\/$/, '')}/login`;
  const tpl = passwordResetTemplate({ user, tempPassword, loginUrl });
  return sendEmail({
    to: user.email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    templateKey: 'password-reset',
    relatedEntity: { type: 'user', id: user.id.toString() },
  });
}
