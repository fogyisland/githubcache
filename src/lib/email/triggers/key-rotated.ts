import type { ApiKey, User } from '@prisma/client';
import { keyRotatedTemplate } from '@/lib/email/templates/key-rotated';
import { sendEmail } from '@/lib/email/sender';
import type { SendEmailResult } from '@/lib/email/sender';

export interface SendKeyRotatedArgs {
  oldKey: Pick<ApiKey, 'id' | 'name'>;
  newKey: Pick<ApiKey, 'id' | 'name'>;
  owner: User;
  origin: string;
}

/**
 * M31.x — key-rotated notification email.
 *
 * Called by the self-rotate server action after the new (pending) ApiKey
 * row is inserted and the old key is revoked. Emails the user — not the
 * admins — because rotation is a user-initiated action and the admins
 * will already see the pending request in /admin/api-keys.
 *
 * The plaintext of the new key is deliberately omitted from this email;
 * the user already saw it once in the rotation dialog. Including it here
 * would leak it to the SMTP provider's logs.
 */
export async function sendKeyRotatedEmail(
  args: SendKeyRotatedArgs,
): Promise<SendEmailResult> {
  const reviewUrl = `${args.origin.replace(/\/$/, '')}/account/keys/${args.newKey.id}`;
  const tpl = keyRotatedTemplate({
    keyOwner: args.owner,
    oldKeyName: args.oldKey.name,
    newKeyId: args.newKey.id,
    newKeyName: args.newKey.name,
    reviewUrl,
  });
  return sendEmail({
    to: args.owner.email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    templateKey: 'key-rotated',
    relatedEntity: { type: 'api_key', id: args.newKey.id.toString() },
  });
}
