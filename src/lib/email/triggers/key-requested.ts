import type { ApiKey, User } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { keyRequestedTemplate } from '@/lib/email/templates/key-requested';
import { sendEmail } from '@/lib/email/sender';
import type { SendEmailResult } from '@/lib/email/sender';

export interface SendKeyRequestedArgs {
  apiKey: Pick<ApiKey, 'id' | 'name'>;
  requester: User;
  origin: string;
}

/**
 * M26 — key-requested email trigger.
 *
 * Called by the /account/keys/request server action after the pending
 * ApiKey row is inserted. Looks up every admin user and emails each one
 * with a deep link to /admin/api-keys/{id}. Failures on individual
 * recipients don't block others — we collect results and return the
 * first failure for logging.
 *
 * Returns an aggregated result so the caller can log/surface the
 * overall outcome. If SMTP isn't configured, every per-recipient send
 * returns `{ok:false, error:'not_configured'}` and the action still
 * succeeds (the request is recorded; the admin just won't get the
 * email).
 */
export async function sendKeyRequestedEmail(
  args: SendKeyRequestedArgs,
): Promise<{ sent: number; failed: number; results: SendEmailResult[] }> {
  const admins = await prisma.user.findMany({
    where: { role: 'admin', status: 'active' },
    select: { id: true, email: true },
  });
  if (admins.length === 0) {
    return { sent: 0, failed: 0, results: [] };
  }

  const approveUrl = `${args.origin.replace(/\/$/, '')}/admin/api-keys/${args.apiKey.id}`;
  const tpl = keyRequestedTemplate({
    apiKeyName: args.apiKey.name,
    requester: args.requester,
    approveUrl,
  });

  const results = await Promise.all(
    admins.map((admin) =>
      sendEmail({
        to: admin.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        templateKey: 'key-requested',
        relatedEntity: { type: 'api_key', id: args.apiKey.id.toString() },
      }),
    ),
  );

  let sent = 0;
  let failed = 0;
  for (const r of results) {
    if (r.ok) sent++;
    else failed++;
  }
  return { sent, failed, results };
}
