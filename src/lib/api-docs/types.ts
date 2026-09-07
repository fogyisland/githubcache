import type { z } from 'zod';

export interface ParamDoc {
  name: string;
  in: 'path' | 'query' | 'header' | 'body';
  type: string;
  required: boolean;
  description: string;
}

export interface HeaderDoc {
  name: string;
  description: string;
  example: string;
}

export interface ErrorDoc {
  status: number;
  /** Machine-readable ErrorCode (M15). See src/lib/api/errors.ts. */
  code: string;
  error: string;
  when: string;
}

/**
 * M15 — caching semantics for an endpoint. External integrators need
 * to know when they'll hit cache vs. wait on a refresh.
 *
 * - `cache-only`    — served from local store only, never live (e.g.
 *                     status snapshot).
 * - `cache-first`   — hit returns immediately; miss queues a refresh
 *                     and the request waits synchronously for the
 *                     first response. Subsequent calls are hits.
 * - `passthrough`   — every call hits the upstream (or a non-cacheable
 *                     computation); cache is not consulted.
 *
 * `freshness_window_seconds` declares how long a cached entry is
 * considered fresh; `stale_path` says whether the server serves stale
 * entries on upstream-down (serve) or fails closed (fail).
 */
export interface CacheDoc {
  mode: 'cache-only' | 'cache-first' | 'passthrough';
  freshness_window_seconds?: number;
  stale_path?: 'serve' | 'fail';
}

export interface EndpointDoc {
  slug: string;
  path: string;
  method: 'GET' | 'POST';
  summary: string;
  description: string;
  auth: 'none' | 'X-API-Key';
  rateLimit: string;
  cache: CacheDoc;
  request?: ParamDoc[];
  response: z.ZodTypeAny;
  responseSamples: Record<string, unknown>;
  headers?: HeaderDoc[];
  errors: ErrorDoc[];
  /**
   * M28.bug4e — language-specific code samples for users who don't want
   * to translate from curl. The Python and JavaScript versions are
   * generated from this field; curl is built separately.
   *
   * If absent, the docs page falls back to a templated example built
   * from `path` / `method` / `request` / `body` — same shape curl uses.
   * Override only when the default doesn't capture something important
   * (e.g. paginating /api/query).
   */
  examples?: {
    python?: string;
    javascript?: string;
  };
}
