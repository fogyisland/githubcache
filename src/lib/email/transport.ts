import type { EmailConfig } from '@prisma/client';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * M25 — thin wrapper around `nodemailer.createTransport`.
 *
 * Why a wrapper?
 *   - Tests can `vi.mock('@/lib/email/transport', ...)` and swap in a
 *     fake transporter without touching the nodemailer package.
 *   - One place to extend with logging / connection pooling / retries
 *     in a future iteration.
 *
 * Accepts an `EmailConfig` row (which carries the raw smtp_pass) and
 * returns a configured SMTP transporter. Callers MUST NOT pass the
 * row across an untrusted boundary (it's never returned to the UI —
 * see `getEmailConfig`).
 */
export function createTransport(row: EmailConfig): Transporter {
  return nodemailer.createTransport({
    host: row.smtpHost,
    port: row.smtpPort,
    secure: row.smtpSecure,
    auth: {
      user: row.smtpUser,
      pass: row.smtpPass,
    },
  });
}
