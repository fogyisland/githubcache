import type { User } from '@prisma/client';
import { SITE_NAME } from '@/lib/config/site';

export interface KeyRequestedTemplateInput {
  apiKeyName: string;
  requester: Pick<User, 'email'>;
  description?: string | null;
  approveUrl: string;
  siteName?: string;
}

/**
 * M26 — key-requested email template.
 *
 * Sent to every admin user when a self-signup operator requests a new
 * API key from /account/keys/request. Includes the requester's email,
 * the requested key name, the optional description they provided, and a
 * deep link straight to /admin/api-keys/[id] so the admin can review
 * and approve the request in one click.
 */
export function keyRequestedTemplate(input: KeyRequestedTemplateInput): {
  subject: string;
  html: string;
  text: string;
} {
  const site = input.siteName ?? SITE_NAME;
  const subject = `${input.requester.email} requested an API key on ${site}`;
  const name = input.apiKeyName;
  const email = input.requester.email;
  const description = input.description ?? '';
  const approveUrl = input.approveUrl;

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; color: #111;">
    <p><strong>${escapeHtml(email)}</strong> requested an API key on <strong>${escapeHtml(site)}</strong>.</p>
    <p>
      <strong>Key name:</strong> ${escapeHtml(name)}<br>
      <strong>Description:</strong> ${description ? escapeHtml(description) : '<em>(none)</em>'}
    </p>
    <p>
      <a href="${escapeAttr(approveUrl)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:4px;">Review request</a>
    </p>
    <p>If the button doesn't work, paste this URL into your browser:</p>
    <p><code>${escapeHtml(approveUrl)}</code></p>
    <hr>
    <p style="color:#666;font-size:12px;">This is an automated notification from ${escapeHtml(site)} — a user just self-requested an API key.</p>
  </body>
</html>`;

  const text = [
    `${email} requested an API key on ${site}.`,
    '',
    `Key name: ${name}`,
    `Description: ${description ? description : '(none)'}`,
    '',
    'Review the request:',
    approveUrl,
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
