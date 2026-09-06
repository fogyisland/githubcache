import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateSession } from '@/lib/auth/session';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { verifyCsrf } from '@/lib/auth/csrf';
import { sendEmail } from '@/lib/email/sender';
import { SITE_NAME } from '@/lib/config/site';
import { apiError } from '@/lib/api/errors';

const Body = z.object({ csrf: z.string().min(1) });

/**
 * POST /api/admin/email/test
 *
 * Sends a test email to the currently-logged-in admin's address.
 * Used by the "Send test" button on /admin/email. Records an
 * `email_log` row with templateKey='test' so admins can verify
 * the round-trip through the log page.
 *
 * Response:
 *   200 — { ok: true, messageId? }
 *   400 — invalid body
 *   403 — not authenticated / invalid CSRF
 *   503 — SMTP not configured (returns `{ ok: false, error: 'not_configured' }`)
 */
export async function POST(req: Request): Promise<Response> {
  const user = await validateSession({
    headers: req.headers,
    cookies: cookiesFromRequest(req),
  });
  if (!user) {
    return apiError('forbidden', 'forbidden', {}, req);
  }
  const raw = (await req.json().catch(() => null)) as unknown;
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return apiError('bad_request', 'invalid body', {}, req);
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return apiError('forbidden', 'invalid csrf', {}, req);
  }

  const subject = `${SITE_NAME} SMTP test`;
  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;">
<p>SMTP test from <strong>${SITE_NAME}</strong>.</p>
<p>If you can read this, your email_config is correctly wired to the SMTP server.</p>
<p style="color:#999;font-size:12px;">Sent at ${new Date().toISOString()}</p>
</body></html>`;
  const text = [
    `SMTP test from ${SITE_NAME}.`,
    '',
    'If you can read this, your email_config is correctly wired to the SMTP server.',
    `Sent at ${new Date().toISOString()}`,
  ].join('\n');

  const result = await sendEmail({
    to: user.email,
    subject,
    html,
    text,
    templateKey: 'test',
    relatedEntity: { type: 'user', id: user.id.toString() },
  });

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      ...(result.messageId ? { messageId: result.messageId } : {}),
    });
  }
  if (result.error === 'not_configured') {
    return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 });
  }
  return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
}
