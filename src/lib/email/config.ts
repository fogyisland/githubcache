import { prisma } from '@/lib/db/client';
import type { EmailConfig } from '@prisma/client';
import { createTransport as nodemailerCreateTransport } from '@/lib/email/transport';

/**
 * M25 — public, password-stripped view of an `email_config` row.
 * `configured: false` means no row exists; `transport` is provided only
 * when configuration is present (and the caller wants to send mail).
 *
 * The raw `smtp_pass` is NEVER returned in this shape — see the
 * security note on the `EmailConfig` Prisma model.
 */
export interface PublicEmailConfig {
  configured: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpFrom?: string;
  replyTo?: string | null;
  smtpSecure?: boolean;
  updatedAt?: Date;
  updatedBy?: bigint | null;
  /** Raw EmailConfig row, used by the transport factory. NEVER return this
   *  over JSON / server-component props — it carries the SMTP password. */
  row?: EmailConfig;
}

/**
 * Look up the singleton `email_config` row (id = 1).
 *
 * - When absent → `{ configured: false }`.
 * - When present → returns the public shape with `row` attached for the
 *   transport factory. The `row` field is for server-side use only.
 *
 * Callers that want to render the config to the admin UI should pass
 * the returned object through `publicConfigForUi()` (see below) to drop
 * the password-bearing row.
 */
export async function getEmailConfig(): Promise<PublicEmailConfig> {
  const row = await prisma.emailConfig.findUnique({ where: { id: 1 } });
  if (!row) {
    return { configured: false };
  }
  return {
    configured: true,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpUser: row.smtpUser,
    smtpFrom: row.smtpFrom,
    replyTo: row.replyTo,
    smtpSecure: row.smtpSecure,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    row,
  };
}

/**
 * Drop the raw row from a config — safe to hand to client components /
 * JSON responses. Use this when you loaded config with `getEmailConfig()`
 * and want to display fields like host / port / from / replyTo.
 */
export function publicConfigForUi(cfg: PublicEmailConfig): Omit<PublicEmailConfig, 'row'> {
  const { row, ...rest } = cfg;
  // Drop the password-bearing row before handing the object to the UI.
  void row;
  return rest;
}

/**
 * Convenience wrapper around `createTransport` from `./transport`. Kept
 * here so callers that need a transport don't have to import both files.
 */
export function createEmailTransport(cfg: PublicEmailConfig): ReturnType<typeof nodemailerCreateTransport> | null {
  if (!cfg.configured || !cfg.row) return null;
  return nodemailerCreateTransport(cfg.row);
}
