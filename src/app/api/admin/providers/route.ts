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
  listProviders,
  createProvider,
  getProviderBySlug,
} from '@/lib/ingestion/providers/db';

/**
 * GET /api/admin/providers
 *
 * List providers. Query params:
 *   enabled — 'true' | 'false' (optional, filter)
 *
 * Admin or operator may list. Admin may create via POST.
 */
export async function GET(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || (user.role !== 'admin' && user.role !== 'operator')) {
    return apiError('forbidden', 'forbidden', {}, req);
  }

  const url = new URL(req.url);
  const enabledParam = url.searchParams.get('enabled');
  let enabled: boolean | undefined;
  if (enabledParam !== null) {
    if (enabledParam !== 'true' && enabledParam !== 'false') {
      return apiError('bad_request', 'enabled must be "true" or "false"', {}, req);
    }
    enabled = enabledParam === 'true';
  }
  const rows = await listProviders({ ...(enabled !== undefined ? { enabled } : {}) });
  return NextResponse.json({
    providers: rows.map((r) => ({
      id: r.id.toString(),
      slug: r.slug,
      name: r.name,
      sourceType: r.sourceType,
      configJson: r.configJson,
      enabled: r.enabled,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}

const CreateBody = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits, hyphens'),
  name: z.string().min(1).max(128),
  config: ProviderConfigSchema,
  enabled: z.boolean().optional(),
  csrf: z.string().min(1),
});

/**
 * POST /api/admin/providers
 *
 * Create a new provider. Admin-only. Audit-logged.
 *
 * Body: `{ slug, name, config, enabled?, csrf }`
 */
export async function POST(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'admin role required', {}, req);
  }
  if (user.status !== 'active') {
    return apiError('forbidden', 'account_disabled', {}, req);
  }

  const raw = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return apiError('bad_request', 'invalid body', { details: { issues: parsed.error.issues } }, req);
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return apiError('forbidden', 'invalid csrf', {}, req);
  }

  const existing = await getProviderBySlug(parsed.data.slug);
  if (existing) {
    return apiError('conflict', 'slug already exists', {}, req);
  }

  // Defense in depth: re-parse config to ensure it's the same shape we accept.
  let configJson: unknown;
  try {
    configJson = parseProviderConfig(parsed.data.config);
  } catch (e: unknown) {
    return apiError('bad_request', 'invalid config', { details: { message: (e as Error).message } }, req);
  }

  const row = await createProvider({
    slug: parsed.data.slug,
    name: parsed.data.name,
    configJson,
    enabled: parsed.data.enabled ?? true,
  });

  const fwd = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: 'create_provider',
    targetType: 'ingestion_provider',
    targetId: row.slug,
    metadata: { name: row.name, sourceType: row.sourceType },
    ...(fwd !== null ? { ip: fwd } : {}),
    actorUserId: user.id,
  });

  return NextResponse.json(
    {
      id: row.id.toString(),
      slug: row.slug,
      name: row.name,
      sourceType: row.sourceType,
      configJson: row.configJson,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    { status: 201 },
  );
}