import type { Invitation, User } from '@prisma/client';
import { inviteTemplate } from '@/lib/email/templates/invite';
import { sendEmail } from '@/lib/email/sender';
import type { SendEmailResult } from '@/lib/email/sender';

/**
 * M25 — invite email trigger.
 *
 * Called by POST /api/admin/users/invite after the Invitation row is
 * created. `origin` is the public URL prefix the invitee should land
 * on (e.g. "https://cache.example.com").
 *
 * Returns the underlying `sendEmail` result — the caller (API route)
 * surfaces `emailSent` in the JSON response. If the SMTP config is
 * missing, the trigger returns `{ok:false, error:'not_configured'}`
 * and the caller logs that; the underlying invitation creation still
 * succeeds (admin can copy the invite link out of band).
 */
export async function sendInviteEmail(
  invitation: Invitation,
  inviter: User,
  origin: string,
): Promise<SendEmailResult> {
  const acceptUrl = `${origin.replace(/\/$/, '')}/request-access?invitation=${invitation.id}`;
  const tpl = inviteTemplate({
    inviter: inviter.email,
    invitation,
    acceptUrl,
  });
  return sendEmail({
    to: invitation.email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    templateKey: 'invite',
    relatedEntity: { type: 'invitation', id: invitation.id },
  });
}
