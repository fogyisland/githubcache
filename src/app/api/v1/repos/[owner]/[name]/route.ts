import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { lookupRepo } from '@/lib/cache/lookup';
import { checkApiKeyHourlyLimit } from '@/lib/rate-limit/bucket';
import { findApiKeyByHash } from '@/lib/db/api-keys';
import { recordRequest } from '@/lib/db/request-log';
import { prisma } from '@/lib/db/client';
import { env } from '@/lib/config/env';
import { apiError } from '@/lib/api/errors';
import { clientIpFromHeaders } from '@/lib/http/client-ip';
import { logger } from '@/lib/logger';

interface RouteContext {
  params: { owner: string; name: string };
}

/**
 * M26.x — `/api/v1/repos/[owner]/[name]` is now authenticated.
 *
 *   - X-API-Key header is required (rejects 401 if missing, 403 if
 *     invalid / revoked / disabled).
 *   - Per-key rate limit is 50_000/hour (env: PUBLIC_REPO_RATE_PER_HOUR)
 *     — same order of magnitude as the M26 signup rate limit, so the
 *     limits across the service read consistently.
 *   - All four response paths still emit a recordRequest row, now with
 *     apiKeyId attached so the /admin/queries view can attribute
 *     traffic to the owner.
 */
export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  const { owner, name } = ctx.params;
  const start = Date.now();
  const ip = clientIpFromHeaders(req.headers);
  const repoRequested = `${owner}/${name}`;

  // 1. Extract and validate X-API-Key.
  const plain = req.headers.get('x-api-key');
  if (!plain) {
    return apiError('unauthorized', 'missing api key', {}, req);
  }
  const hash = createHash('sha256').update(plain).digest('hex');
  const apiKey = await findApiKeyByHash(hash);
  if (!apiKey || apiKey.status !== 'active') {
    return apiError('forbidden', 'invalid api key', {}, req);
  }

  // 2. Per-key hourly rate limit (default 50_000, env-tunable).
  const rl = await checkApiKeyHourlyLimit(apiKey.id, env.PUBLIC_REPO_RATE_PER_HOUR);
  if (!rl.allowed) {
    void recordRequest({
      endpoint: '/api/v1/repos/[owner]/[name]',
      apiKeyId: apiKey.id,
      repoRequested,
      cacheHit: false,
      durationMs: Date.now() - start,
      statusCode: 429,
      ...(ip !== null ? { ip } : {}),
    }).catch((e: unknown) => logger.error({ err: e }, 'request log failed'));
    return apiError(
      'rate_limited',
      'rate limit exceeded',
      {
        details: { retryAfter: rl.retryAfterSeconds },
        headers: {
          'Retry-After': String(rl.retryAfterSeconds),
          'X-RateLimit-Limit': String(rl.limit),
          'X-RateLimit-Remaining': String(Math.max(0, rl.limit - rl.count)),
        },
      },
      req,
    );
  }

  // 3. Fire-and-forget lastUsedAt update.
  void prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch((e: unknown) => logger.error({ err: e }, 'lastUsedAt update failed'));

  // 4. Lookup the repo (cache hit / miss → GitHub fetch, M20).
  const result = await lookupRepo(owner, name);
  if (result.fetch_status === 'not_found') {
    void recordRequest({
      endpoint: '/api/v1/repos/[owner]/[name]',
      apiKeyId: apiKey.id,
      repoRequested,
      cacheHit: false,
      durationMs: Date.now() - start,
      statusCode: 404,
      ...(ip !== null ? { ip } : {}),
    }).catch((e: unknown) => logger.error({ err: e }, 'request log failed'));
    return NextResponse.json(
      {
        repository: { owner, name },
        fetch_status: 'not_found',
        error: result.error,
      },
      { status: 404 },
    );
  }
  if (result.fetch_status === 'pending') {
    // M20: cache miss → enqueued for scheduler fetch. v1 has no wait param,
    // so we return 202 Accepted with the same pending semantics as /api/query.
    void recordRequest({
      endpoint: '/api/v1/repos/[owner]/[name]',
      apiKeyId: apiKey.id,
      repoRequested,
      cacheHit: false,
      durationMs: Date.now() - start,
      statusCode: 202,
      ...(ip !== null ? { ip } : {}),
    }).catch((e: unknown) => logger.error({ err: e }, 'request log failed'));
    return NextResponse.json(
      {
        repository: { owner, name },
        fetch_status: 'pending',
        queued_at: result.queuedAt,
        scheduled_for: result.scheduledFor,
      },
      { status: 202 },
    );
  }
  if (result.fetch_status === 'error') {
    logger.warn({ owner, name, error: result.error }, 'public v1 repo lookup error');
    void recordRequest({
      endpoint: '/api/v1/repos/[owner]/[name]',
      apiKeyId: apiKey.id,
      repoRequested,
      cacheHit: false,
      durationMs: Date.now() - start,
      statusCode: 503,
      ...(ip !== null ? { ip } : {}),
    }).catch((e: unknown) => logger.error({ err: e }, 'request log failed'));
    return NextResponse.json(
      {
        repository: { owner, name },
        fetch_status: 'error',
        error: result.error,
      },
      { status: 503 },
    );
  }
  void recordRequest({
    endpoint: '/api/v1/repos/[owner]/[name]',
    apiKeyId: apiKey.id,
    repoRequested,
    cacheHit: true,
    durationMs: Date.now() - start,
    statusCode: 200,
    ...(ip !== null ? { ip } : {}),
  }).catch((e: unknown) => logger.error({ err: e }, 'request log failed'));
  return NextResponse.json(
    {
      fetch_status: 'ok',
      repository: result.metadata,
      fetched_at: result.last_fetched_at,
      ...(result.stale ? { stale: true } : {}),
      ...(result.warning ? { warning: result.warning } : {}),
    },
    { status: 200 },
  );
}
