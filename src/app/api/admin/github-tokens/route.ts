import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { listAllTokens, insertToken } from '@/lib/db/github-tokens';
import { writeAudit } from '@/lib/audit/writer';
import { apiError } from '@/lib/api/errors';

const PostBody = z.object({
  label: z.string().min(1).max(100),
  token: z.string().min(20).max(200),
  csrf: z.string().min(1),
});

/**
 * GET /api/admin/github-tokens
 *
 * Returns the list of registered tokens (DB rows). Admin OR operator
 * may list (per spec §9.1). No role restriction at this layer — the
 * page also serves operators.
 *
 * Response codes:
 *   200 — { tokens: GithubToken[] }
 *   403 — not authenticated
 */
export async function GET(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user) {
    return apiError('forbidden', 'forbidden', {}, req);
  }
  const { rows: tokens } = await listAllTokens({ skip: 0, take: 1000 });
  // Serialize BigInt ids to strings (NextResponse.json doesn't handle BigInt)
  return NextResponse.json({
    tokens: tokens.map((t) => ({
      ...t,
      id: t.id.toString(),
    })),
  });
}

/**
 * POST /api/admin/github-tokens
 *
 * Admin-only. Registers a new token metadata row. The plaintext token
 * is consumed to compute first4 / last4 / hash and then DISCARDED —
 * per Path A ruling, plaintext is not stored anywhere (see brief §RULING).
 * The DB row contains label + first4 + last4 + hash only.
 *
 * Response codes:
 *   200 — { ok, id, message }
 *   400 — invalid body
 *   403 — not admin / invalid CSRF
 *   409 — token already registered (duplicate hash)
 */
export async function POST(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'forbidden', {}, req);
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return apiError('bad_request', 'invalid body', {}, req);
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return apiError('forbidden', 'invalid csrf', {}, req);
  }

  const first4 = parsed.data.token.slice(0, 4);
  const last4 =
    parsed.data.token.length >= 4 ? parsed.data.token.slice(-4) : parsed.data.token;
  const hash = createHash('sha256').update(parsed.data.token).digest('hex');

  // Check for duplicate hash
  const existing = await listAllTokens({ skip: 0, take: 1000 });
  const dup = existing.rows.find((t) => t.tokenHash === hash);
  if (dup) {
    return apiError('conflict', 'token already registered', {}, req);
  }

  const row = await insertToken({
    label: parsed.data.label,
    tokenFirst4: first4,
    tokenLast4: last4,
    tokenHash: hash,
  }).catch((e: unknown) => {
    // Prisma P2002 = unique constraint violation on tokenHash.
    // Race window: listAllTokens() above checked for an existing hash, but
    // two concurrent POSTs can both pass the check before either inserts.
    // The DB constraint is the source of truth — return 409 in that case.
    if (
      e instanceof Error &&
      'code' in e &&
      (e as { code?: unknown }).code === 'P2002'
    ) {
      return null;
    }
    throw e;
  });
  if (row === null) {
    return apiError('conflict', 'token already registered', {}, req);
  }

  const fwd = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: 'register_token',
    targetType: 'github_token',
    targetId: String(row.id),
    metadata: { label: parsed.data.label, first4, last4 },
    actorUserId: user.id,
    ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
  });

  return NextResponse.json({
    ok: true,
    id: row.id.toString(),
    message: 'Token registered. Activate by adding to GITHUB_TOKENS env / file and restarting.',
  });
}
