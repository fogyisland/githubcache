import { z } from 'zod';
import { parseNodes } from '@/lib/cache/parser';
import { v1ReposResponseSchema } from './v1-repos';

/**
 * Schema for POST /api/query batch endpoint.
 *
 * `queryNodeSchema` / `queryBodySchema` document the strict shape — but
 * the actual server-side validator is `parseNodes` (src/lib/cache/parser.ts)
 * which accepts richer inputs (string "owner/name", URL strings, objects
 * with either `name` or `repo` field). MAX_NODES is 50 in parseNodes, not
 * the plan's 100.
 */

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
  results: z.array(v1ReposResponseSchema),
  summary: z.object({
    hit: z.number().int().describe('Results with fetch_status=ok and found.'),
    miss: z.number().int().describe('Results where found=false.'),
    stale: z.number().int().describe('Results served stale (refresh failed since last ok).'),
  }),
});

export const querySample: z.infer<typeof queryResponseSchema> = {
  results: [
    {
      fetch_status: 'ok',
      repository: {
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
      fetched_at: '2026-08-27T12:00:00.000Z',
    },
  ],
  summary: { hit: 1, miss: 0, stale: 0 },
};