import { NextResponse } from 'next/server';
import { lookupRepo } from '@/lib/cache/lookup';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-bucket';
import { clientIpFromHeaders } from '@/lib/http/client-ip';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/logger';

interface RouteContext {
  params: { owner: string; name: string };
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  const { owner, name } = ctx.params;
  const ip = clientIpFromHeaders(req.headers);

  const rl = await checkIpRateLimit(ip, env.PUBLIC_LOOKUP_RATE_PER_MIN);
  if (!rl.allowed) {
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
    return NextResponse.json(
      {
        repository: { owner, name },
        fetch_status: 'error',
        error: result.error,
      },
      { status: 503 },
    );
  }
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
