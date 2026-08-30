import { NextResponse } from 'next/server';
import { lookupRepo } from '@/lib/cache/lookup';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-bucket';
import { clientIpFromHeaders } from '@/lib/http/client-ip';
import { recordRequest } from '@/lib/db/request-log';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/logger';

interface RouteContext {
  params: { owner: string; name: string };
}

/**
 * M16 — the v1 endpoint is now logged to RequestLog so the new /admin/queries
 * view can see anonymous traffic alongside authenticated /api/query calls.
 * All four response paths emit one fire-and-forget recordRequest call; we
 * never let a log write delay or fail the actual response.
 */
export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  const { owner, name } = ctx.params;
  const start = Date.now();
  const ip = clientIpFromHeaders(req.headers);
  const repoRequested = `${owner}/${name}`;

  const rl = await checkIpRateLimit(ip, env.PUBLIC_LOOKUP_RATE_PER_MIN);
  if (!rl.allowed) {
    void recordRequest({
      endpoint: '/api/v1/repos/[owner]/[name]',
      repoRequested,
      cacheHit: false,
      durationMs: Date.now() - start,
      statusCode: 429,
      ...(ip !== null ? { ip } : {}),
    }).catch((e: unknown) => logger.error({ err: e }, 'request log failed'));
    return NextResponse.json(
      { error: 'rate limit exceeded', retryAfter: rl.retryAfterSeconds },
      {
        status: 429,
        headers: {
          'Retry-After': String(rl.retryAfterSeconds),
          'X-RateLimit-Limit': String(rl.limit),
          'X-RateLimit-Remaining': String(Math.max(0, rl.limit - rl.count)),
        },
      },
    );
  }

  const result = await lookupRepo(owner, name);
  if (result.fetch_status === 'not_found') {
    void recordRequest({
      endpoint: '/api/v1/repos/[owner]/[name]',
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
  if (result.fetch_status === 'error') {
    logger.warn({ owner, name, error: result.error }, 'public v1 repo lookup error');
    void recordRequest({
      endpoint: '/api/v1/repos/[owner]/[name]',
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
