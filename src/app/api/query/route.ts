import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { parseNodes } from '@/lib/cache/parser';
import { lookupRepo, type QueryResult } from '@/lib/cache/lookup';
import { prisma } from '@/lib/db/client';
import { findApiKeyByHash } from '@/lib/db/api-keys';
import { recordRequest } from '@/lib/db/request-log';
import { checkRateLimit } from '@/lib/rate-limit/bucket';
import { logger } from '@/lib/logger';

export async function POST(req: Request): Promise<Response> {
  const start = Date.now();

  // 1. Extract and validate X-API-Key
  const plain = req.headers.get('x-api-key');
  if (!plain) {
    return NextResponse.json({ error: 'missing api key' }, { status: 401 });
  }
  const hash = createHash('sha256').update(plain).digest('hex');
  const apiKey = await findApiKeyByHash(hash);
  if (!apiKey || apiKey.status !== 'active') {
    return NextResponse.json({ error: 'invalid api key' }, { status: 403 });
  }

  // 2. Rate limit per key (durable bucket, M8.1; was in-memory tokenBucket pre-M8)
  const rl = await checkRateLimit(apiKey.id, apiKey.rateLimitPerMin);
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

  // 3. Fire-and-forget lastUsedAt update
  void prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch((e: unknown) => logger.error({ err: e }, 'lastUsedAt update failed'));

  // 4. Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'malformed json' }, { status: 400 });
  }
  const parsed = parseNodes(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // 5. Existing route logic — delegated to lookupRepo (M9.3 extraction)
  const results = await Promise.all(
    parsed.nodes.map((n): Promise<QueryResult> => lookupRepo(n.owner, n.name)),
  );

  const summary = {
    hit: results.filter((r) => r.fetch_status === 'ok' && r.found).length,
    miss: results.filter((r) => !r.found).length,
    stale: results.filter((r) => 'stale' in r && r.stale === true).length,
  };
  const response = NextResponse.json({ results, summary });

  // 6. Fire-and-forget request log — one row per /api/query invocation.
  // For multi-node batches, repoRequested captures only the first node's
  // original input.
  const firstNode = parsed.nodes[0];
  const fwd = req.headers.get('x-forwarded-for');
  void recordRequest({
    apiKeyId: apiKey.id,
    endpoint: '/api/query',
    ...(firstNode !== undefined ? { repoRequested: firstNode.original } : {}),
    cacheHit: summary.hit === results.length,
    durationMs: Date.now() - start,
    statusCode: 200,
    ...(fwd !== null ? { ip: fwd ?? undefined } : {}),
  }).catch((e: unknown) => logger.error({ err: e }, 'request log failed'));

  return response;
}
