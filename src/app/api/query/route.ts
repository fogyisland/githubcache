import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { parseNodes } from '@/lib/cache/parser';
import { getRepoMetadata } from '@/lib/cache/read';
import { fetchRepoCore } from '@/lib/github/client';
import { parseRepoResponse } from '@/lib/github/fields';
import { storeRepoMetadata } from '@/lib/cache/write';
import { GitHubUnavailable, NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db/client';
import { findApiKeyByHash } from '@/lib/db/api-keys';
import { recordRequest } from '@/lib/db/request-log';
import { checkRateLimit } from '@/lib/rate-limit/bucket';
import { nextDueForStatus } from '@/lib/scheduler/aging';
import type { FetchStatus, Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';

// In-process dedupe: concurrent first-miss requests for the same
// owner/name share one upstream fetch. M5 may replace with a durable
// lock if multi-process becomes a concern.
const pending = new Map<string, Promise<unknown>>();

async function firstMiss(owner: string, name: string): Promise<void> {
  const key = `${owner}/${name}`;
  const existing = pending.get(key);
  if (existing) {
    await existing;
    return;
  }
  const p = (async () => {
    try {
      const { data, etag } = await fetchRepoCore(owner, name);
      const baseWrite = {
        owner,
        name,
        node: key as unknown as Prisma.InputJsonValue,
        metadata: parseRepoResponse(data),
        fetchStatus: 'ok' as const,
      };
      if (etag !== undefined) {
        await storeRepoMetadata({ ...baseWrite, etag });
      } else {
        await storeRepoMetadata(baseWrite);
      }
    } catch (e: unknown) {
      if (e instanceof NotFoundError) {
        await storeRepoMetadata({
          owner,
          name,
          node: key as unknown as Prisma.InputJsonValue,
          metadata: null,
          fetchStatus: 'not_found',
          fetchError: '404',
        });
        return;
      }
      logger.error({ err: e, owner, name }, 'first-miss fetch failed');
      throw e;
    }
  })();
  pending.set(key, p);
  try {
    await p;
  } finally {
    pending.delete(key);
  }
}

interface ResultOk {
  canonical: string;
  original: string;
  found: true;
  metadata: unknown;
  last_fetched_at: Date | null;
  fetch_status: 'ok';
  stale: boolean;
  warning?: string;
}
interface ResultNotFound {
  canonical: string;
  original: string;
  found: false;
  fetch_status: 'not_found';
  error: string;
}
interface ResultError {
  canonical: string;
  original: string;
  found: false;
  fetch_status: 'error';
  error: string;
}
type QueryResult = ResultOk | ResultNotFound | ResultError;

const STALE_WARNING = 'data may be delayed';

/**
 * A row is stale when its fetchStatus window has elapsed since lastFetchedAt.
 * Used to surface `stale: true` + a "data may be delayed" warning on cache hits
 * whose 'ok' fetch has aged past the 24h TTL.
 *
 * Returns false when lastFetchedAt is null (never fetched — caller treats this
 * as fresh and overwrites via firstMiss).
 */
function isStale(
  fetchStatus: FetchStatus,
  lastFetchedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastFetchedAt) return false;
  return now > nextDueForStatus(fetchStatus, lastFetchedAt);
}

function buildOkResult(
  owner: string,
  repoName: string,
  original: string,
  metadata: unknown,
  lastFetchedAt: Date | null,
  fetchStatus: FetchStatus,
): ResultOk {
  const stale = isStale(fetchStatus, lastFetchedAt);
  return {
    canonical: `${owner}/${repoName}`,
    original,
    found: true,
    metadata,
    last_fetched_at: lastFetchedAt,
    fetch_status: 'ok',
    stale,
    ...(stale ? { warning: STALE_WARNING } : {}),
  };
}

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

  // 5. Existing route logic
  const results = await Promise.all(
    parsed.nodes.map(async (n): Promise<QueryResult> => {
      const r = await getRepoMetadata(n.owner, n.name);
      if (r.found) {
        if (r.fetchStatus === 'ok') {
          return buildOkResult(n.owner, n.name, n.original, r.metadata, r.lastFetchedAt, r.fetchStatus);
        }
        if (r.fetchStatus === 'not_found') {
          return {
            canonical: `${n.owner}/${n.name}`,
            original: n.original,
            found: false,
            fetch_status: 'not_found',
            error: 'Repository not found or private',
          };
        }
        // forbidden/error: stale cache hit, treat as miss to allow refetch.
        // M4 multi-token pool will handle forbidden rotation properly.
      }
      try {
        await firstMiss(n.owner, n.name);
      } catch (e: unknown) {
        // M8.2: GitHubUnavailable (network down / DNS fail / connection refused)
        // triggers the stale path. If we have a prior 'ok' row, serve it with
        // stale:true + a warning. Otherwise fall through to the error response.
        if (e instanceof GitHubUnavailable) {
          const stale = await getRepoMetadata(n.owner, n.name);
          if (stale.found && stale.fetchStatus === 'ok') {
            return buildOkResult(
              n.owner,
              n.name,
              n.original,
              stale.metadata,
              stale.lastFetchedAt,
              stale.fetchStatus,
            );
          }
        }
        const msg = e instanceof Error ? e.message : 'unknown';
        return {
          canonical: `${n.owner}/${n.name}`,
          original: n.original,
          found: false,
          fetch_status: 'error',
          error: msg,
        };
      }
      const r2 = await getRepoMetadata(n.owner, n.name);
      if (!r2.found) {
        return {
          canonical: `${n.owner}/${n.name}`,
          original: n.original,
          found: false,
          fetch_status: 'error',
          error: 'first-miss did not write a row',
        };
      }
      if (r2.fetchStatus === 'not_found') {
        return {
          canonical: `${n.owner}/${n.name}`,
          original: n.original,
          found: false,
          fetch_status: 'not_found',
          error: 'Repository not found or private',
        };
      }
      return buildOkResult(
        n.owner,
        n.name,
        n.original,
        r2.metadata,
        r2.lastFetchedAt,
        r2.fetchStatus,
      );
    }),
  );

  const summary = {
    hit: results.filter((r) => r.fetch_status === 'ok' && r.found).length,
    miss: results.filter((r) => !r.found).length,
    stale: 0,
  };
  const response = NextResponse.json({ results, summary });

  // 6. Fire-and-forget request log — one row per /api/query invocation.
  // For multi-node batches, repoRequested captures only the first node's
  // original input. M5/M7 may refine to per-node records.
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
