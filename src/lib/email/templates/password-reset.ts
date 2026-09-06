import type { User } from '@prisma/client';
import { SITE_NAME } from '@/lib/config/site';

export interface PasswordResetTemplateInput {
  user: User;
  tempPassword: string;
  loginUrl: string;
  siteName?: string;
}

/**
 * M25 — password reset email template.
 *
 * Subject is i18n-aware via SITE_NAME. The temp password is highlighted
 * in a code block; we surface a security warning that all sessions are
 * invalidated and the user must change the password immediately.
 */
export function passwordResetTemplate(input: PasswordResetTemplateInput): {
  subject: string;
  html: string;
  text: string;
} {
  const site = input.siteName ?? SITE_NAME;
  const subject = `Your ${site} password was reset`;
  const temp = input.tempPassword;
  const loginUrl = input.loginUrl;
  const email = input.user.email;

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; color: #111;">
    <p>An administrator reset your password on <strong>${escapeHtml(site)}</strong> for the account <strong>${escapeHtml(email)}</strong>.</p>
    <p>Your temporary password:</p>
    <pre style="background:#f4f4f5;padding:12px;border-radius:4px;font-family:Menlo,Consolas,monospace;font-size:14px;">${escapeHtml(temp)}</pre>
    <p>Sign in at <a href="${escapeAttr(loginUrl)}">${escapeHtml(loginUrl)}</a> and change your password immediately.</p>
    <p style="color:#b91c1c;"><strong>Important:</strong> all sessions for this account have been invalidated. Anyone using the previous password is signed out. If you did not request this reset, contact an administrator.</p>
  </body>
</html>`;

  const text = [
    `An administrator reset your password on ${site} for the account ${email}.`,
    '',
    'Your temporary password:',
    temp,
    '',
    `Sign in at ${loginUrl} and change your password immediately.`,
    '',
    'Important: all sessions for this account have been invalidated. Anyone using the previous password is signed out. If you did not request this reset, contact an administrator.',
  ].join('\n');

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
