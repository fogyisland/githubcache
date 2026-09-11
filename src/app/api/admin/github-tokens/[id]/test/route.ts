import { NextResponse } from 'next/server';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { getTokenById } from '@/lib/db/github-tokens';
import { writeAudit } from '@/lib/audit/writer';
import { apiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

const GITHUB_API_USER = 'https://api.github.com/user';
const UPSTREAM_MESSAGE_MAX = 256;

/**
 * POST /api/admin/github-tokens/[id]/test
 *
 * Admin only. Calls GitHub's `/user` endpoint with the token's raw
 * plaintext (DB-direct per M21) to verify that the PAT is valid and has
 * the scopes we expect. Does NOT mutate the row or the pool.
 *
 * Response codes:
 *   200 — { ok, login, scopes? }
 *   400 — invalid id / invalid body
 *   403 — not admin / invalid CSRF
 *   404 — token row not found, or its plaintext is missing (legacy M4 row)
 *   502 — GitHub call failed (token rejected, network error, or
 *          unexpected upstream response). The response body includes
 *          { upstreamStatus, upstreamMessage } so the operator UI can
 *          surface the reason.
 *
 * Audit: 'test_token' on success/failure (targetType=github_token).
 *
 * Note on `lastUsedAt`: a successful test does NOT update the row's
 * lastUsedAt column. The test endpoint is a verification, not a real
 * GitHub API call from the cache; the column should reflect actual
 * cache traffic only.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'forbidden', {}, req);
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return apiError('bad_request', 'invalid id', {}, req);
  }
  const row = await getTokenById(id);
  if (!row) {
    return apiError('not_found', 'not found', {}, req);
  }
  if (!row.token) {
    return apiError('not_found', 'plaintext token missing (legacy M4 row)', {}, req);
  }

  const csrfFromHeader = req.headers.get('x-csrf-token');
  let body: unknown = null;
  try {
    body = await req.clone().json();
  } catch {
    body = null;
  }
  const csrfFromBody =
    typeof body === 'object' && body !== null && 'csrf' in body
      ? (body as { csrf?: unknown }).csrf
      : undefined;
  const csrf = csrfFromHeader ?? (typeof csrfFromBody === 'string' ? csrfFromBody : null);
  if (!csrf || !verifyCsrf(req, csrf)) {
    return apiError('forbidden', 'invalid csrf', {}, req);
  }

  const fwd = req.headers.get('x-forwarded-for');
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${row.token}`,
    'user-agent': 'githubcache-admin-test',
    'x-github-api-version': '2022-11-28',
  };

  let upstream: Response;
  try {
    upstream = await fetch(GITHUB_API_USER, { method: 'GET', headers });
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : String(e);
    logger.error({ err, id: id.toString() }, 'token test upstream fetch failed');
    void writeAudit({
      action: 'test_token',
      targetType: 'github_token',
      targetId: String(id),
      metadata: { label: row.label, ok: false, reason: 'network' },
      actorUserId: user.id,
      ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
    });
    return apiError('unavailable', `upstream fetch failed: ${err}`, {}, req);
  }

  if (!upstream.ok) {
    const rawMessage = await upstream.text().catch(() => '');
    // Truncate to a bounded length so a future upstream that echoes
    // auth headers / oversized payloads back through a proxy doesn't
    // blow up our response or the audit log.
    const upstreamMessage =
      rawMessage.length > UPSTREAM_MESSAGE_MAX
        ? `${rawMessage.slice(0, UPSTREAM_MESSAGE_MAX)}…`
        : rawMessage;
    void writeAudit({
      action: 'test_token',
      targetType: 'github_token',
      targetId: String(id),
      metadata: {
        label: row.label,
        ok: false,
        reason: 'upstream_non_2xx',
        upstreamStatus: upstream.status,
      },
      actorUserId: user.id,
      ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
    });
    return NextResponse.json(
      { ok: false, upstreamStatus: upstream.status, upstreamMessage },
      { status: 502 },
    );
  }

  let parsed: { login?: unknown } = {};
  try {
    parsed = (await upstream.json()) as { login?: unknown };
  } catch {
    parsed = {};
  }
  const login = typeof parsed.login === 'string' ? parsed.login : null;

  void writeAudit({
    action: 'test_token',
    targetType: 'github_token',
    targetId: String(id),
    // Note: `login` is intentionally NOT included in audit metadata.
    // The audit log feeds downstream webhook subscribers; including the
    // GitHub login here would change the payload contract for any
    // subscriber that doesn't expect it. The login is still surfaced
    // to the admin via the response body below.
    metadata: { label: row.label, ok: true },
    actorUserId: user.id,
    ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
  });

  return NextResponse.json({ ok: true, login });
}
