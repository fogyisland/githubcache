import type { User } from '@prisma/client';
import { signupWelcomeTemplate } from '@/lib/email/templates/signup-welcome';
import { sendEmail } from '@/lib/email/sender';
import type { SendEmailResult } from '@/lib/email/sender';

export interface SendSignupWelcomeArgs {
  user: User;
  origin: string;
}

/**
 * M26 — signup welcome email trigger.
 *
 * Called by the /signup server action after a successful user creation.
 * `origin` is the public URL prefix the user should land on (e.g.
 * "https://cache.example.com"). The login URL is appended as `/login`.
 *
 * Returns the underlying `sendEmail` result so the caller can log/surface
 * the failure mode. If SMTP isn't configured, the trigger returns
 * `{ok:false, error:'not_configured'}` — signup itself still succeeds.
 */
export async function sendSignupWelcomeEmail(
  args: SendSignupWelcomeArgs,
): Promise<SendEmailResult> {
  const loginUrl = `${args.origin.replace(/\/$/, '')}/login`;
  const tpl = signupWelcomeTemplate({ user: args.user, loginUrl });
  return sendEmail({
    to: args.user.email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    templateKey: 'signup-welcome',
    relatedEntity: { type: 'user', id: args.user.id.toString() },
  });
}
