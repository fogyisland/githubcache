import type { User } from '@prisma/client';
import { SITE_NAME } from '@/lib/config/site';

export interface SignupWelcomeTemplateInput {
  user: Pick<User, 'email'>;
  loginUrl: string;
  siteName?: string;
}

/**
 * M26 — welcome email sent right after a successful /signup submission.
 *
 * No verification token (out of scope for M26 — login works immediately
 * after signup). The body just confirms the account exists, points the
 * new user at /account/keys to request an API key, and reassures that
 * an admin will review the request before approval.
 */
export function signupWelcomeTemplate(input: SignupWelcomeTemplateInput): {
  subject: string;
  html: string;
  text: string;
} {
  const site = input.siteName ?? SITE_NAME;
  const subject = `Welcome to ${site}`;
  const email = input.user.email;
  const loginUrl = input.loginUrl;

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; color: #111;">
    <p>Welcome to <strong>${escapeHtml(site)}</strong>!</p>
    <p>Your account <strong>${escapeHtml(email)}</strong> is now active. You can sign in immediately — no verification step required.</p>
    <p>Next steps:</p>
    <ol>
      <li>Sign in at <a href="${escapeAttr(loginUrl)}">${escapeHtml(loginUrl)}</a>.</li>
      <li>Visit <code>/account/keys</code> to request an API key.</li>
      <li>An administrator will review your request and approve it.</li>
    </ol>
    <p>If you did not create this account, please ignore this email.</p>
  </body>
</html>`;

  const text = [
    `Welcome to ${site}!`,
    '',
    `Your account ${email} is now active. You can sign in immediately — no verification step required.`,
    '',
    'Next steps:',
    `1. Sign in at ${loginUrl}.`,
    '2. Visit /account/keys to request an API key.',
    '3. An administrator will review your request and approve it.',
    '',
    'If you did not create this account, please ignore this email.',
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
