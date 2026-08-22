import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { getApiKeyById, updateApiKeyLimits } from '@/lib/db/api-keys';
import { writeAudit } from '@/lib/audit/writer';

const PatchBody = z.object({
  rateLimitPerMin: z.number().int().min(1).max(10000),
  dailyQuota: z.number().int().min(1).max(10000000),
  csrf: z.string().min(1),
});

/**
 * PATCH /api/admin/api-keys/[id]
 *
 * Admin OR operator (per spec §9.1). Updates the rate-limit and
 * daily-quota fields on an API key. Audits `change_key_limits` with
 * before/after values.
 *
 * The middleware already enforces CSRF on all non-GET /api/admin/*. This
 * handler does a defense-in-depth check against the body token.
 *
 * Response codes:
 *   200 — { ok: true }
 *   400 — invalid body
 *   403 — not authenticated / invalid CSRF
 *   404 — key not found
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  // Auth: admin OR operator (per spec §9.1)
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const target = await getApiKeyById(id);
  if (!target) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return NextResponse.json({ error: 'invalid csrf' }, { status: 403 });
  }

  const before = {
    rateLimitPerMin: target.rateLimitPerMin,
    dailyQuota: target.dailyQuota,
  };

  await updateApiKeyLimits(id, {
    rateLimitPerMin: parsed.data.rateLimitPerMin,
    dailyQuota: parsed.data.dailyQuota,
  });

  const fwd = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: 'change_key_limits',
    targetType: 'api_key',
    targetId: String(id),
    metadata: {
      before,
      after: {
        rateLimitPerMin: parsed.data.rateLimitPerMin,
        dailyQuota: parsed.data.dailyQuota,
      },
    },
    actorUserId: user.id,
    ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
  });

  return NextResponse.json({ ok: true });
}