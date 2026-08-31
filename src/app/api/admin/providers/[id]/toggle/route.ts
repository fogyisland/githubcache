import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { apiError } from '@/lib/api/errors';
import { writeAudit } from '@/lib/audit/writer';
import {
  getProviderById,
  updateProvider,
} from '@/lib/ingestion/providers/db';

/**
 * POST /api/admin/providers/[id]/toggle
 *
 * Flip the `enabled` flag. Admin-only.
 */
const Body = z.object({ csrf: z.string().min(1) });

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'admin role required', {}, req);
  }
  if (user.status !== 'active') {
    return apiError('forbidden', 'account_disabled', {}, req);
  }

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    return apiError('bad_request', 'invalid id', {}, req);
  }

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return apiError('bad_request', 'invalid body', {}, req);
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return apiError('forbidden', 'invalid csrf', {}, req);
  }

  const existing = await getProviderById(id);
  if (!existing) return apiError('not_found', 'not found', {}, req);

  const updated = await updateProvider(id, { enabled: !existing.enabled });

  const fwd = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: updated.enabled ? 'enable_provider' : 'disable_provider',
    targetType: 'ingestion_provider',
    targetId: updated.slug,
    ...(fwd !== null ? { ip: fwd } : {}),
    actorUserId: user.id,
  });

  return NextResponse.json({
    id: updated.id.toString(),
    enabled: updated.enabled,
  });
}