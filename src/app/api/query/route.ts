import { NextResponse } from 'next/server';
import { parseNodes } from '@/lib/cache/parser';
import { getRepoMetadata } from '@/lib/cache/read';
import { fetchRepoCore } from '@/lib/github/client';
import { parseRepoResponse } from '@/lib/github/fields';
import { storeRepoMetadata } from '@/lib/cache/write';
import { NotFoundError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';

// TODO: integrate tokenBucket (src/lib/rate-limit/memory.ts) in M3.
// M2.3 brief defers rate-limiting; we still consume the upstream call directly.

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
  stale: false;
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

export async function POST(req: Request): Promise<Response> {
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

  const results = await Promise.all(
    parsed.nodes.map(async (n): Promise<QueryResult> => {
      const r = await getRepoMetadata(n.owner, n.name);
      if (r.found) {
        if (r.fetchStatus === 'ok') {
          return {
            canonical: `${n.owner}/${n.name}`,
            original: n.original,
            found: true,
            metadata: r.metadata,
            last_fetched_at: r.lastFetchedAt,
            fetch_status: 'ok',
            stale: false,
          };
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
      return {
        canonical: `${n.owner}/${n.name}`,
        original: n.original,
        found: true,
        metadata: r2.metadata,
        last_fetched_at: r2.lastFetchedAt,
        fetch_status: 'ok',
        stale: false,
      };
    }),
  );

  const summary = {
    hit: results.filter((r) => r.fetch_status === 'ok' && r.found).length,
    miss: results.filter((r) => !r.found).length,
    stale: 0,
  };
  return NextResponse.json({ results, summary });
}