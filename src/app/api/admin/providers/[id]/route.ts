import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { apiError } from '@/lib/api/errors';
import { writeAudit } from '@/lib/audit/writer';
import {
  ProviderConfigSchema,
  parseProviderConfig,
} from '@/lib/ingestion/providers/schema';
import {
  getProviderById,
  updateProvider,
  deleteProvider,
} from '@/lib/ingestion/providers/db';

async function authenticate(req: Request) {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user) return { error: apiError('forbidden', 'forbidden', {}, req) } as const;
  if (user.status !== 'active') {
    return { error: apiError('forbidden', 'account_disabled', {}, req) } as const;
  }
  return { user } as const;
}

function parseId(idParam: string): bigint | null {
  try {
    return BigInt(idParam);
  } catch {
    return null;
  }
}

/**
 * GET /api/admin/providers/[id]
 *
 * Returns one provider row. Admin or operator may read.
 */
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const auth = await authenticate(req);
  if ('error' in auth) return auth.error;
  if (auth.user.role !== 'admin' && auth.user.role !== 'operator') {
    return apiError('forbidden', 'forbidden', {}, req);
  }

  const id = parseId(params.id);
  if (!id) return apiError('bad_request', 'invalid id', {}, req);

  const row = await getProviderById(id);
  if (!row) return apiError('not_found', 'not found', {}, req);

  return NextResponse.json({
    id: row.id.toString(),
    slug: row.slug,
    name: row.name,
    sourceType: row.sourceType,
    configJson: row.configJson,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

const PatchBody = z.object({
  name: z.string().min(1).max(128).optional(),
  config: ProviderConfigSchema.optional(),
  enabled: z.boolean().optional(),
  csrf: z.string().min(1),
});

/**
 * PATCH /api/admin/providers/[id]
 *
 * Update one or more fields. Admin-only. Slug is immutable.
 *
 * Body: `{ name?, config?, enabled?, csrf }`
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const auth = await authenticate(req);
  if ('error' in auth) return auth.error;
  if (auth.user.role !== 'admin') {
    return apiError('forbidden', 'admin role required', {}, req);
  }

  const id = parseId(params.id);
  if (!id) return apiError('bad_request', 'invalid id', {}, req);

  const raw = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return apiError('bad_request', 'invalid body', { details: { issues: parsed.error.issues } }, req);
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return apiError('forbidden', 'invalid csrf', {}, req);
  }

  const existing = await getProviderById(id);
  if (!existing) return apiError('not_found', 'not found', {}, req);

  let configJson: unknown | undefined;
  if (parsed.data.config !== undefined) {
    try {
      configJson = parseProviderConfig(parsed.data.config);
    } catch (e: unknown) {
      return apiError('bad_request', 'invalid config', { details: { message: (e as Error).message } }, req);
    }
  }

  const updated = await updateProvider(id, {
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(configJson !== undefined ? { configJson } : {}),
    ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
  });

  const fwd = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: 'update_provider',
    targetType: 'ingestion_provider',
    targetId: updated.slug,
    metadata: {
      before: { name: existing.name, enabled: existing.enabled },
      after: { name: updated.name, enabled: updated.enabled },
    },
    ...(fwd !== null ? { ip: fwd } : {}),
    actorUserId: auth.user.id,
  });

  return NextResponse.json({
    id: updated.id.toString(),
    slug: updated.slug,
    name: updated.name,
    sourceType: updated.sourceType,
    configJson: updated.configJson,
    enabled: updated.enabled,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
}

/**
 * DELETE /api/admin/providers/[id]
 *
 * Delete a provider. Admin-only.
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const auth = await authenticate(req);
  if ('error' in auth) return auth.error;
  if (auth.user.role !== 'admin') {
    return apiError('forbidden', 'admin role required', {}, req);
  }

  const id = parseId(params.id);
  if (!id) return apiError('bad_request', 'invalid id', {}, req);

  const existing = await getProviderById(id);
  if (!existing) return apiError('not_found', 'not found', {}, req);

  await deleteProvider(id);

  const fwd = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: 'delete_provider',
    targetType: 'ingestion_provider',
    targetId: existing.slug,
    metadata: { name: existing.name },
    ...(fwd !== null ? { ip: fwd } : {}),
    actorUserId: auth.user.id,
  });

  return NextResponse.json({ ok: true });
}