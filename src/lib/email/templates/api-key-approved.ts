import type { User } from '@prisma/client';
import { SITE_NAME } from '@/lib/config/site';

export interface ApiKeyApprovedTemplateInput {
  keyOwner: User;
  plaintextKey: string;
  apiKeyName: string;
  siteName?: string;
}

/**
 * M25 — API key approval email template.
 *
 * The plaintext key is shown ONCE — in a code block with a clear
 * "treat like a password" warning. This is the only place the user
 * will ever see the raw key.
 */
export function apiKeyApprovedTemplate(input: ApiKeyApprovedTemplateInput): {
  subject: string;
  html: string;
  text: string;
} {
  const site = input.siteName ?? SITE_NAME;
  const subject = `Your API key ${input.apiKeyName} is approved`;
  const key = input.plaintextKey;
  const apiKeyName = input.apiKeyName;
  const email = input.keyOwner.email;

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; color: #111;">
    <p>An administrator approved your API key <strong>${escapeHtml(apiKeyName)}</strong> on <strong>${escapeHtml(site)}</strong> for the account <strong>${escapeHtml(email)}</strong>.</p>
    <p><strong style="color:#b91c1c;">Treat this like a password.</strong> Copy it now — you will not see it again:</p>
    <pre style="background:#f4f4f5;padding:12px;border-radius:4px;font-family:Menlo,Consolas,monospace;font-size:13px;word-break:break-all;">${escapeHtml(key)}</pre>
    <p>Send it as the <code>X-API-Key</code> header when calling the API. If you lose it, an admin will need to revoke and re-issue the key.</p>
  </body>
</html>`;

  const text = [
    `An administrator approved your API key ${apiKeyName} on ${site} for the account ${email}.`,
    '',
    'Treat this like a password. Copy it now — you will not see it again:',
    key,
    '',
    "Send it as the X-API-Key header when calling the API. If you lose it, an admin will need to revoke and re-issue the key.",
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
