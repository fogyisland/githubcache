import type { Invitation } from '@prisma/client';
import { SITE_NAME } from '@/lib/config/site';

export interface InviteTemplateInput {
  inviter: string;
  invitation: Invitation;
  acceptUrl: string;
  siteName?: string;
}

/**
 * M25 — invite email template.
 *
 * Subject is i18n-aware via the SITE_NAME constant — translations in
 * `messages/*.json` keep the locale-specific brand phrasing, but
 * templates are hardcoded English (per design — fixed templates,
 * no per-locale editor).
 */
export function inviteTemplate(input: InviteTemplateInput): {
  subject: string;
  html: string;
  text: string;
} {
  const site = input.siteName ?? SITE_NAME;
  const subject = `You're invited to ${site}`;
  const inviter = input.inviter;
  const acceptUrl = input.acceptUrl;
  const expiresAt = input.invitation.expiresAt.toUTCString();
  const role = input.invitation.role;

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; color: #111;">
    <p>${escapeHtml(inviter)} has invited you to join <strong>${escapeHtml(site)}</strong> as a <strong>${escapeHtml(role)}</strong>.</p>
    <p>Accept the invitation within 7 days (expires ${escapeHtml(expiresAt)}):</p>
    <p><a href="${escapeAttr(acceptUrl)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:4px;">Accept invitation</a></p>
    <p>If the button doesn't work, paste this URL into your browser:</p>
    <p><code>${escapeHtml(acceptUrl)}</code></p>
    <hr>
    <p style="color:#666;font-size:12px;">This invitation was sent because an admin added you to ${escapeHtml(site)}. If you weren't expecting this, you can ignore the email.</p>
  </body>
</html>`;

  const text = [
    `${inviter} has invited you to join ${site} as a ${role}.`,
    '',
    'Accept the invitation within 7 days (expires ' + expiresAt + '):',
    acceptUrl,
    '',
    "If you weren't expecting this, you can ignore the email.",
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
