import { z } from 'zod';

/**
 * Schema for GET /api/v1/status response payload.
 *
 * Mirrors the actual wire format produced by src/app/api/v1/status/route.ts:
 * snake_case for queue fields (in_progress) and repository groups (not_found,
 * forbidden). The route intentionally omits a DB ping latency — `db` is the
 * literal 'up' | 'down'.
 */
export const v1StatusSchema = z.object({
  ok: z.boolean().describe('True if DB is reachable and the cache has been written at least once.'),
  db: z.enum(['up', 'down']).describe("DB connectivity. 'down' returns HTTP 503."),
  tokens: z.object({
    active: z.number().int().describe('GitHub tokens with status=active.'),
    exhausted: z.number().int().describe('Tokens in 429 cool-down (used >= limit and reset is in the future).'),
    total: z.number().int().describe('All GitHub tokens, including revoked and disabled.'),
    source: z.literal('db'),
  }),
  queue: z.object({
    pending: z.number().int(),
    in_progress: z.number().int().describe('Refresh jobs currently being processed.'),
    done: z.number().int().describe('Jobs completed in the last 24h (filtered on updatedAt since schema has no completedAt).'),
    failed: z.number().int(),
  }),
  repositories: z.object({
    total: z.number().int(),
    ok: z.number().int().describe('Repositories with fetch_status=ok.'),
    not_found: z.number().int(),
    forbidden: z.number().int().describe('Repos that returned 403 from GitHub (private/limited).'),
    error: z.number().int(),
  }),
  // M26.x — surface the scheduler state so the public /status page can
  // show whether the refresh worker is actively draining the queue.
  scheduler: z.object({
    paused: z.boolean().describe('True if the refresh scheduler is paused (manual or auto). When paused, no refresh jobs are processed.'),
  }),
  version: z.object({
    commit: z.string().describe('Git SHA of the deployed build, or "unknown".'),
    startedAt: z.string().describe('ISO 8601 timestamp when this process started.'),
    nodeVersion: z.string().describe('Node.js version string.'),
  }),
  timestamp: z.string().describe('ISO 8601 timestamp when this status response was generated.'),
});

export const v1StatusSample: z.infer<typeof v1StatusSchema> = {
  ok: true,
  db: 'up',
  tokens: { active: 3, exhausted: 0, total: 4, source: 'db' },
  queue: { pending: 0, in_progress: 0, done: 12, failed: 0 },
  repositories: { total: 46, ok: 42, not_found: 3, forbidden: 0, error: 1 },
  scheduler: { paused: false },
  version: {
    commit: '83ea4cd',
    startedAt: '2026-08-27T12:00:00.000Z',
    nodeVersion: 'v20.10.0',
  },
  timestamp: '2026-08-27T12:00:00.000Z',
};