import type { User } from '@prisma/client';
import { apiKeyApprovedTemplate } from '@/lib/email/templates/api-key-approved';
import { sendEmail } from '@/lib/email/sender';
import type { SendEmailResult } from '@/lib/email/sender';

/**
 * M25 — API key approval email trigger.
 *
 * Called by POST /api/admin/api-keys/[id]/approve after `approveKey`
 * returns the plaintext key. The plaintext is included in the email
 * body so the user can copy it once. The DB never stores the raw
 * bytes — they are hashed on insert.
 */
export async function sendApiKeyApprovedEmail(
  keyOwner: User,
  plaintextKey: string,
  apiKeyName: string,
): Promise<SendEmailResult> {
  const tpl = apiKeyApprovedTemplate({ keyOwner, plaintextKey, apiKeyName });
  return sendEmail({
    to: keyOwner.email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    templateKey: 'api-key-approved',
    relatedEntity: { type: 'user', id: keyOwner.id.toString() },
  });
}
