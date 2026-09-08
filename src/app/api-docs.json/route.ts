import { NextResponse } from 'next/server';
import { ENDPOINT_DOCS } from '@/lib/api-docs/registry';

/**
 * GET /api-docs.json
 *
 * M15 — machine-readable summary of every public endpoint, intended
 * for external integrators who want to code against the API without
 * reading the prose /docs site.
 *
 * Shape is intentionally lightweight — NOT a full OpenAPI 3.x spec.
 * Each endpoint carries:
 *   - path, method, summary, description
 *   - auth, rateLimit
 *   - cache: { mode, freshness_window_seconds?, stale_path? }
 *   - request: parameter list (path / query / header / body)
 *   - response: { samples } — concrete JSON examples (no schema)
 *   - headers: non-standard response headers
 *   - errors: [{ status, code, error, when }]
 *
 * Top-level `caching` block describes the server-wide refresh strategy
 * (scheduler cadence + on-miss behavior) so integrators know when to
 * expect cached vs. live data without reading the source.
 *
 * Cacheable for 5 minutes (the registry is static at runtime; only
 * `generatedAt` changes per request — clients only need it for drift
 * detection).
 *
 * M28.bug8: do NOT import `@/lib/config/env` here — the route is
 * `force-static` and Next.js evaluates it during build's page-data
 * collection phase, before DATABASE_URL is guaranteed to be present.
 * The cadence fields below are static defaults; if you need them
 * live, switch to `force-dynamic`.
 */
export const dynamic = 'force-static';
export const revalidate = 300;

const DEFAULT_SCHEDULER_TICK_MS = 60_000;
const DEFAULT_NIGHTLY_SWEEP_MS = 24 * 60 * 60 * 1000;

export function GET(): Response {
  const generatedAt = new Date().toISOString();
  const payload = {
    version: '1.0',
    generatedAt,
    caching: {
      refresh_strategy: 'scheduler + on-miss',
      scheduler_tick_ms: DEFAULT_SCHEDULER_TICK_MS,
      nightly_sweep_ms: DEFAULT_NIGHTLY_SWEEP_MS,
      default_freshness_window_seconds: Math.round(
        DEFAULT_NIGHTLY_SWEEP_MS / 1000,
      ),
      stale_path_on_github_down: 'serve',
    },
    endpoints: ENDPOINT_DOCS.map((e) => ({
      path: e.path,
      method: e.method,
      summary: e.summary,
      description: e.description,
      auth: e.auth,
      rateLimit: e.rateLimit,
      cache: e.cache,
      request: e.request ?? [],
      response: { samples: e.responseSamples },
      headers: e.headers ?? [],
      errors: e.errors,
    })),
  };
  return NextResponse.json(payload, {
    headers: {
      'cache-control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
}