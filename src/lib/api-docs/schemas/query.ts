import { z } from 'zod';
import { parseNodes } from '@/lib/cache/parser';

/**
 * Schema for POST /api/query batch endpoint.
 *
 * `queryNodeSchema` / `queryBodySchema` document the strict shape — but
 * the actual server-side validator is `parseNodes` (src/lib/cache/parser.ts)
 * which accepts richer inputs (string "owner/name", URL strings, objects
 * with either `name` or `repo` field). MAX_NODES is 50 in parseNodes.
 *
 * `queryResultOkSchema` / `queryResultNotFoundSchema` / `queryResultErrorSchema`
 * mirror the actual wire format produced by `lookupRepo` in
 * `src/lib/cache/lookup.ts` (QueryResult discriminated union). The route
 * handler serialises raw `QueryResult` objects directly via NextResponse.json
 * with no reshaping, so the docs schema must match exactly.
 */

// RepoCoreData mirror from src/lib/github/fields.ts — no `owner` field
// (owner lives only in `canonical`/`original`, never in the cached metadata).
const repoCoreDataSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  private: z.boolean().describe('True if the repo is private on GitHub.'),
  defaultBranch: z.string().describe("GitHub's default_branch for this repo."),
  stars: z.number().int(),
  forks: z.number().int(),
  watchers: z.number().int().describe('GitHub subscribers_count.'),
  createdAt: z.string().describe('ISO 8601 timestamp from GitHub.'),
  updatedAt: z.string().describe('ISO 8601 timestamp from GitHub.'),
  pushedAt: z.string().nullable().describe('ISO 8601 timestamp; null if the repo has no pushes.'),
  language: z.string().nullable(),
  license: z.string().nullable().describe('SPDX license id, e.g. "MIT".'),
  topics: z.array(z.string()),
  homepage: z.string().nullable(),
  archived: z.boolean(),
  disabled: z.boolean(),
}).describe('Cached repository metadata, mirroring RepoCoreData from src/lib/github/fields.ts.');

export const queryResultOkSchema = z.object({
  canonical: z.string().describe('Canonical "owner/name" lookup key.'),
  original: z.string().describe('Original input string passed to the API.'),
  found: z.literal(true),
  metadata: repoCoreDataSchema,
  last_fetched_at: z.string().nullable().describe('ISO 8601 timestamp of last successful GitHub fetch; null if never fetched.'),
  fetch_status: z.literal('ok'),
  stale: z.boolean().describe('True if the cached row is past its refresh TTL (24h since last fetch).'),
  warning: z.string().optional().describe('Set to STALE_WARNING constant ("data may be delayed") when stale=true.'),
});

export const queryResultNotFoundSchema = z.object({
  canonical: z.string(),
  original: z.string(),
  found: z.literal(false),
  fetch_status: z.literal('not_found'),
  error: z.string().describe('Human-readable reason, e.g. "Repository not found or private".'),
});

export const queryResultErrorSchema = z.object({
  canonical: z.string(),
  original: z.string(),
  found: z.literal(false),
  fetch_status: z.literal('error'),
  error: z.string().describe('Error message from the upstream fetch attempt.'),
});

export const queryResultSchema = z.discriminatedUnion('fetch_status', [
  queryResultOkSchema,
  queryResultNotFoundSchema,
  queryResultErrorSchema,
]);

export const queryNodeSchema = z.object({
  owner: z.string().min(1).max(39).regex(/^[A-Za-z0-9-]+$/).describe('GitHub username or org.'),
  name: z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/).describe('GitHub repo name.'),
});

export const queryBodySchema = z.object({
  nodes: z.array(queryNodeSchema).min(1).max(50).describe('Up to 50 repos per batch (matches parseNodes MAX_NODES).'),
});

// Re-export parseNodes so docs route can show "validated body shape".
// parseNodes accepts strings ("owner/name" or full GitHub URLs) AND objects
// ({ owner, name } or { owner, repo }), so it is more permissive than the
// strict queryBodySchema above.
export const validateQueryBody = (body: unknown) => parseNodes(body);

export const queryResponseSchema = z.object({
  results: z.array(queryResultSchema),
  summary: z.object({
    hit: z.number().int().describe('Results with fetch_status=ok and found=true.'),
    miss: z.number().int().describe('Results where found=false (fetch_status=not_found or error).'),
    stale: z.number().int().describe('Results whose cached row is past its refresh TTL.'),
  }),
});

export const querySample: z.infer<typeof queryResponseSchema> = {
  results: [
    {
      canonical: 'octocat/Hello-World',
      original: 'octocat/Hello-World',
      found: true,
      metadata: {
        name: 'Hello-World',
        description: 'My first repo on GitHub!',
        private: false,
        defaultBranch: 'master',
        stars: 2000,
        forks: 900,
        watchers: 80,
        createdAt: '2011-01-26T19:01:12Z',
        updatedAt: '2026-08-15T10:00:00Z',
        pushedAt: '2026-08-15T09:55:00Z',
        language: 'C',
        license: 'MIT',
        topics: ['demo'],
        homepage: null,
        archived: false,
        disabled: false,
      },
      last_fetched_at: '2026-08-27T12:00:00.000Z',
      fetch_status: 'ok',
      stale: false,
    },
  ],
  summary: { hit: 1, miss: 0, stale: 0 },
};
