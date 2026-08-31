import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { apiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { writeAudit } from '@/lib/audit/writer';
import { poolSize } from '@/lib/github/pool';
import { getProviderById } from '@/lib/ingestion/providers/db';
import {
  runProvider,
  ProviderNotFoundError,
  ProviderDisabledError,
} from '@/lib/ingestion/providers/run';
import { ProviderSourceError } from '@/lib/ingestion/providers/source';

/**
 * POST /api/admin/providers/[id]/run
 *
 * Enqueue refresh_jobs for every stale + new owner/name pair the
 * provider resolves. Audit-logged.
 *
 * Body: `{ limit?: number, dryRun?: boolean, csrf }`
 *
 * Admin or operator may run. Dry runs are no-ops at the DB layer.
 *
 * The response includes a `poolEmpty` flag so the UI can warn that
 * jobs will fail at fetch time when no GitHub tokens are configured.
 */
const Body = z.object({
  limit: z.number().int().min(1).max(10000).optional(),
  dryRun: z.boolean().optional(),
  csrf: z.string().min(1),
});

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || (user.role !== 'admin' && user.role !== 'operator')) {
    return apiError('forbidden', 'forbidden', {}, req);
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

  const provider = await getProviderById(id);
  if (!provider) return apiError('not_found', 'not found', {}, req);

  const dryRun = parsed.data.dryRun === true;

  try {
    const result = await runProvider(provider.slug, {
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      dryRun,
    });
    const poolEmpty = poolSize() === 0;

    if (!dryRun) {
      const fwd = req.headers.get('x-forwarded-for');
      void writeAudit({
        action: 'run_provider',
        targetType: 'ingestion_provider',
        targetId: provider.slug,
        metadata: {
          totals: result.totals,
          jobCount: result.jobCount,
          limit: parsed.data.limit ?? null,
        },
        ...(fwd !== null ? { ip: fwd } : {}),
        actorUserId: user.id,
      });
    }

    return NextResponse.json({ ...result, poolEmpty });
  } catch (e: unknown) {
    if (e instanceof ProviderNotFoundError) {
      return apiError('not_found', 'provider not found', {}, req);
    }
    if (e instanceof ProviderDisabledError) {
      return apiError('conflict', 'provider disabled', {}, req);
    }
    if (e instanceof ProviderSourceError) {
      return apiError('bad_request', e.message, { details: { code: e.code } }, req);
    }
    logger.error({ err: e, providerId: id }, 'run provider failed');
    return apiError('internal_error', 'run failed', {}, req);
  }
}