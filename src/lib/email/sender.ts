import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { getEmailConfig } from '@/lib/email/config';
import { createTransport } from '@/lib/email/transport';
import {
  createEmailLog,
  recordEmailFailed,
  recordEmailSent,
} from '@/lib/email/log';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  templateKey: string;
  relatedEntity?: { type: string; id: string };
  /**
   * When set, overrides the SMTP_FROM field from `email_config`. Useful
   * for the "send test" button so the admin sees the email come from
   * a known sender identity.
   */
  fromOverride?: string;
}

export type SendEmailResult =
  | { ok: true; logId: bigint; messageId?: string }
  | { ok: false; logId: bigint; error: string };

/**
 * M25 — top-level send pipeline.
 *
 *   1. Insert an `email_log` row in `queued` state (audit trail starts
 *      before SMTP — if the process crashes between insert and send,
 *      an operator can find the row and manually retry).
 *   2. Load `email_config`. If absent → mark log failed (`not_configured`),
 *      return `{ok:false}`.
 *   3. Build a transport via the `createTransport` factory.
 *   4. `transport.sendMail(...)` — on success: update log to `sent` with
 *      the provider messageId + sentAt; on error: update log to `failed`
 *      with the error message truncated to 1000 chars.
 *   5. Return the result.
 *
 * Triggers (invite / reset / api-key-approved) wrap this; they do NOT
 * add extra DB writes or audit rows (the `email_log` row IS the audit
 * for the email attempt).
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  // Step 1 — queued log row
  const log = await createEmailLog({
    recipient: args.to,
    subject: args.subject,
    templateKey: args.templateKey,
    ...(args.relatedEntity ? { relatedEntity: args.relatedEntity } : {}),
  });

  // Step 2 — config lookup
  const cfg = await getEmailConfig();
  if (!cfg.configured || !cfg.row) {
    await recordEmailFailed(log.id, 'not_configured');
    return { ok: false, logId: log.id, error: 'not_configured' };
  }

  // Step 3 — build transport
  const transport = createTransport(cfg.row);

  // Step 4 — send
  try {
    const info = await transport.sendMail({
      from: args.fromOverride ?? cfg.row.smtpFrom,
      to: args.to,
      ...(cfg.row.replyTo ? { replyTo: cfg.row.replyTo } : {}),
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    await recordEmailSent(log.id, info.messageId);
    return { ok: true, logId: log.id, ...(info.messageId ? { messageId: info.messageId } : {}) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'send failed';
    logger.error({ err: e, to: args.to, templateKey: args.templateKey }, 'email send failed');
    await recordEmailFailed(log.id, msg);
    return { ok: false, logId: log.id, error: msg };
  }
}

/**
 * Lightweight test helper used by /api/admin/email/test. Bypasses the
 * email_log write so admins can send a test email without polluting the
 * log; used directly by the test-send route which DOES write its own
 * log row with templateKey='test'.
 */
export async function sendRawEmail(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
}): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
  const cfg = await getEmailConfig();
  if (!cfg.configured || !cfg.row) {
    return { ok: false, error: 'not_configured' };
  }
  const transport = createTransport(cfg.row);
  try {
    const info = await transport.sendMail({
      from: args.from ?? cfg.row.smtpFrom,
      to: args.to,
      ...(cfg.row.replyTo ? { replyTo: cfg.row.replyTo } : {}),
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    return { ok: true, ...(info.messageId ? { messageId: info.messageId } : {}) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'send failed';
    return { ok: false, error: msg };
  }
}

/**
 * Touch the singleton row's `updatedAt` + `updatedBy` after a config
 * save. Called from the save-config server action so audit metadata
 * stays accurate. Does NOT change the password (caller must handle that).
 */
export async function bumpEmailConfigUpdatedBy(actorUserId: bigint | null): Promise<void> {
  try {
    await prisma.emailConfig.update({
      where: { id: 1 },
      data: { updatedBy: actorUserId },
    });
  } catch {
    // If no row exists yet (first save happens via upsert path), swallow —
    // the upsert will set the field correctly.
  }
}
