import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { parseNodes } from '@/lib/cache/parser';
import { lookupRepo, type QueryResult } from '@/lib/cache/lookup';
import { prisma } from '@/lib/db/client';
import { findApiKeyByHash } from '@/lib/db/api-keys';
import { recordRequest } from '@/lib/db/request-log';
import { checkRateLimit } from '@/lib/rate-limit/bucket';
import { apiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

export async function POST(req: Request): Promise<Response> {
  const start = Date.now();

  // 1. Extract and validate X-API-Key
  const plain = req.headers.get('x-api-key');
  if (!plain) {
    return apiError('unauthorized', 'missing api key', {}, req);
  }
  const hash = createHash('sha256').update(plain).digest('hex');
  const apiKey = await findApiKeyByHash(hash);
  if (!apiKey || apiKey.status !== 'active') {
    return apiError('forbidden', 'invalid api key', {}, req);
  }

  // 2. Rate limit per key (durable bucket, M8.1; was in-memory tokenBucket pre-M8)
  const rl = await checkRateLimit(apiKey.id, apiKey.rateLimitPerMin);
  if (!rl.allowed) {
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

  // 3. Fire-and-forget lastUsedAt update
  void prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch((e: unknown) => logger.error({ err: e }, 'lastUsedAt update failed'));

  // 4. Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('bad_request', 'malformed json', {}, req);
  }
  const parsed = parseNodes(body);
  if (!parsed.ok) {
    return apiError('bad_request', parsed.error, {}, req);
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
