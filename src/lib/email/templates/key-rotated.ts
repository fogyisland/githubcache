import type { User } from '@prisma/client';
import { SITE_NAME } from '@/lib/config/site';

export interface KeyRotatedTemplateInput {
  keyOwner: User;
  oldKeyName: string;
  newKeyId: bigint;
  newKeyName: string;
  reviewUrl: string;
  siteName?: string;
}

/**
 * M31.x — key-rotated notification email template.
 *
 * Sent after the user self-rotates an API key. The plaintext of the
 * NEW key is intentionally NOT included — the user already saw it
 * in the modal after the rotate action completed. This email only
 * serves as an audit-style notification that a rotation happened and
 * that the new key is awaiting admin review.
 *
 * If plaintext were embedded here it would land in the SMTP provider's
 * logs / archive, defeating the point of the rotation flow.
 */
export function keyRotatedTemplate(input: KeyRotatedTemplateInput): {
  subject: string;
  html: string;
  text: string;
} {
  const site = input.siteName ?? SITE_NAME;
  const subject = `API key rotated: ${input.oldKeyName}`;
  const ownerEmail = input.keyOwner.email;

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; color: #111;">
    <p>You rotated the API key <strong>${escapeHtml(input.oldKeyName)}</strong> on <strong>${escapeHtml(site)}</strong> for the account <strong>${escapeHtml(ownerEmail)}</strong>.</p>
    <p>The old key has been revoked. A new request named <strong>${escapeHtml(input.newKeyName)}</strong> is now waiting for administrator review.</p>
    <p>Until an administrator approves the new key, your integrations will not authenticate. The new plaintext key was shown to you in the rotation dialog &mdash; if you did not copy it, request another rotation after the current request is reviewed.</p>
    <p><a href="${escapeHtml(input.reviewUrl)}" style="display:inline-block;padding:8px 14px;background:#0f172a;color:#fff;text-decoration:none;border-radius:4px;">View pending request</a></p>
  </body>
</html>`;

  const text = [
    `You rotated the API key ${input.oldKeyName} on ${site} for the account ${ownerEmail}.`,
    '',
    'The old key has been revoked. A new request named',
    `${input.newKeyName}`,
    'is now waiting for administrator review.',
    '',
    'Until an administrator approves the new key, your integrations will not authenticate.',
    'The new plaintext key was shown to you in the rotation dialog — if you did not copy it,',
    'request another rotation after the current request is reviewed.',
    '',
    `View pending request: ${input.reviewUrl}`,
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
