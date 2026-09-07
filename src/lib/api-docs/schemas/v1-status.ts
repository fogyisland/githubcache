import { z } from 'zod';

/**
 * Schema for GET /api/v1/status response payload.
 *
 * Mirrors the actual wire format produced by src/app/api/v1/status/route.ts:
 * snake_case for queue fields (in_progress) and repository groups (not_found,
 * forbidden). The route intentionally omits a DB ping latency — `db` is the
 * literal 'up' | 'down'.
 *
 * M28.bug4e — `database` + `drift` give consumers enough info to debug
 * "is my connection pointed at the right schema?" and "did the dev DB
 * get rebuilt out-of-band?" without having to hit the DB or run the
 * drift-check script themselves. This is the same data `db:check-drift`
 * and the boot log expose, just surfaced over the public API for
 * dashboards and external monitoring.
 */
export const v1StatusSchema = z.object({
  ok: z.boolean().describe('True if DB is reachable and the cache has been written at least once.'),
  db: z.enum(['up', 'down']).describe("DB connectivity. 'down' returns HTTP 503."),
  // M28.bug4e — which schema DATABASE() resolved to. Many debug tickets
  // come from connections pointed at the wrong schema; surfacing this
  // directly removes the guesswork.
  database: z.string().nullable().describe('MySQL schema name (DATABASE()) the connection is on. Null when DB is down.'),
  // M28.bug4e — drift summary. drift.ok=true means every expected table
  // was found AND none were rebuilt after the latest migration.
  drift: z.object({
    ok: z.boolean().describe('True when all expected tables exist and were not rebuilt after the latest migration.'),
    lastMigration: z.string().nullable().describe('ISO 8601 of the most recent _prisma_migrations.finished_at.'),
    graceMin: z.number().int().describe('Grace window in minutes — tables rebuilt within this window after the latest migration are tolerated.'),
    tablesScanned: z.number().int().describe('Number of expected tables that exist in the current schema.'),
    tablesExpected: z.number().int().describe('Total number of tables the drift check looks for.'),
    drifted: z.array(z.string()).describe('Table names whose CREATE_TIME is more than graceMin after the latest migration.'),
    missing: z.array(z.string()).describe('Expected tables not present in the current schema.'),
  }).nullable().describe('Schema-drift check summary. Null when the check could not run (DB unreachable).'),
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
  database: 'githubcache',
  drift: {
    ok: true,
    lastMigration: '2026-09-07T11:07:51.248Z',
    graceMin: 5,
    tablesScanned: 17,
    tablesExpected: 17,
    drifted: [],
    missing: [],
  },
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