import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { createInvitation } from '@/lib/db/invitations';
import { prisma } from '@/lib/db/client';
import { writeAudit } from '@/lib/audit/writer';

const Body = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'operator']),
  csrf: z.string().min(1),
});

/**
 * Build a `{get}` adapter for `validateSession` from the raw `Cookie`
 * header. This mirrors the cookieMap pattern from the admin layout,
 * adapted to read from `req.headers` rather than `next/headers` cookies().
 *
 * Reading cookies via `req.headers` lets the route handler work both in
 * the Next.js request scope AND in Vitest tests (where `cookies()` from
 * `next/headers` throws "called outside a request scope").
 */
function cookiesFromRequest(req: Request): {
  get(name: string): { value: string } | undefined;
} {
  const header = req.headers.get('cookie') ?? '';
  const map: Record<string, string> = {};
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq);
    const v = trimmed.slice(eq + 1);
    if (!(k in map)) map[k] = v;
  }
  return {
    get: (name: string): { value: string } | undefined =>
      map[name] !== undefined ? { value: map[name]! } : undefined,
  };
}

/**
 * POST /api/admin/users/invite
 *
 * Admin-only. Creates a pending Invitation and returns the link the admin
 * should share with the invitee.
 *
 * Middleware enforces CSRF on non-GET /api/admin/*; we re-verify here as
 * defense in depth (mirrors M6.6 auth/login route).
 *
 * Response codes:
 *   200 — { inviteLink }
 *   400 — invalid body
 *   403 — not admin (or CSRF invalid)
 *   409 — email already has an active user OR a pending invitation
 */
export async function POST(req: Request): Promise<Response> {
  // Auth: admin only
  const user = await validateSession({
    headers: req.headers,
    cookies: cookiesFromRequest(req),
  });
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // CSRF (defense-in-depth: middleware also checks)
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return NextResponse.json({ error: 'invalid csrf' }, { status: 403 });
  }

  // Check for existing active user with this email
  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (existing) {
    return NextResponse.json({ error: 'user already exists' }, { status: 409 });
  }

  // Check for existing unconsumed, unexpired invitation
  const openInvite = await prisma.invitation.findFirst({
    where: {
      email: parsed.data.email,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (openInvite) {
    return NextResponse.json({ error: 'invitation already pending' }, { status: 409 });
  }

  // Create invitation
  const invitation = await createInvitation(parsed.data.email, parsed.data.role, user.id);

  // Audit (fire-and-forget)
  const fwd = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: 'invite_user',
    targetType: 'user',
    targetId: invitation.id,
    metadata: { email: parsed.data.email, role: parsed.data.role },
    actorUserId: user.id,
    ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
  });

  const origin = req.headers.get('origin') ?? new URL(req.url).origin;
  return NextResponse.json({
    inviteLink: `${origin}/request-access?invitation=${invitation.id}`,
  });
}
