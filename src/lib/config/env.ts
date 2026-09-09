import { z } from 'zod';

const schema = z.object({
  // M28.bug16 — DATABASE_URL is OPTIONAL in the schema so the build
  // (`next build` page-data collection) can succeed before the wizard
  // has written the real value to .env. Validation happens at Prisma
  // client construction time (@/lib/db/client) where a missing URL throws
  // a clear "DATABASE_URL is required" message instead of a confusing
  // ZodError during a random route's page-data collection step.
  //
  // No format validation here either — empty / placeholder strings pass
  // (build needs to succeed with no .env), and Prisma's actual connect
  // call surfaces the real connection error at request time.
  DATABASE_URL: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 chars')
    .default('dev-secret-change-me-32-chars-min-aaaaa'),
  SCHEDULER_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(60_000),
  NIGHTLY_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(24 * 60 * 60_000),
  SCHEDULER_ENABLED: z.coerce.boolean().default(true),
  WEBHOOK_WORKER_TICK_MS: z.coerce.number().int().positive().default(15_000),
  WEBHOOK_WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  // Per-IP rate limit for the public lookup form (no X-API-Key required).
  // Protects the GitHub token pool from anonymous abuse.
  PUBLIC_LOOKUP_RATE_PER_MIN: z.coerce.number().int().positive().default(30),
  // M26.x — /api/v1/repos/[owner]/[name] now requires an API key; this
  // is the per-key hourly ceiling. 50_000 is generous (≈14 req/sec)
  // and matches the M26 signup rate limit so all limits across the
  // service share the same order of magnitude.
  PUBLIC_REPO_RATE_PER_HOUR: z.coerce.number().int().positive().default(50_000),
  // M27.3 — read-path switch. When true, getRepoMetadata sources data
  // from the new typed columns + repo_releases / repo_branches tables
  // instead of the legacy `metadata` JSON. Off by default; flip on
  // for a canary run before rolling out globally. See .superpowers/sdd/
  // m27-incremental-refresh/ for the rollout plan.
  M27_READ_FROM_TABLES: z.coerce.boolean().default(false),
  // M27.4 — refresh-by-kind switch. When true, refreshOne dispatches
  // by job.kind: `core` does the full re-fetch (today's path);
  // `releases` hits only /releases; `branches` hits only /branches.
  // Off by default; M27.5's per-facet scheduler enqueues the
  // releases + branches jobs once this is on.
  M27_REFRESH_BY_KIND: z.coerce.boolean().default(false),
  // M27.5 — per-facet sweep cadences. The releases + branches sweeps
  // run daily by default (cheap, only list endpoints). The core sweep
  // runs weekly — the full /repos/{o}/{n} call is more expensive
  // (~5k calls/day for 1k repos at 1-per-5min cadence).
  SCHEDULER_RELEASES_SWEEP_HOURS: z.coerce.number().int().positive().default(24),
  SCHEDULER_BRANCHES_SWEEP_HOURS: z.coerce.number().int().positive().default(24),
  SCHEDULER_CORE_SWEEP_HOURS: z.coerce.number().int().positive().default(168),
  // Consecutive-429 auto-disable threshold for pool tokens (M14.4).
  // When a token returns 429 this many times in a row (with no intervening
  // success), the pool automatically marks it 'disabled' and drops it.
  // Set to 0 to disable auto-disable entirely (manual disable only).
  // NOTE: in-memory counter; multi-replica deployments see N * replicas
  // effective threshold since counters are per-process.
  TOKEN_AUTO_DISABLE_THRESHOLD: z.coerce.number().int().min(0).default(3),
  // When behind a proxy / load balancer, trust X-Forwarded-For for the
  // client IP used in per-IP rate-limit + audit logs. Set to 1 only when
  // the upstream proxy strips/sets client IP correctly.
  TRUST_PROXY: z.coerce.boolean().default(false),
  // M17 — Database backup retention. After every successful backup the
  // oldest files in BACKUP_DIR are trimmed so the directory holds at
  // most this many .sql.gz files. Set to 0 to keep forever (not
  // recommended — disk fills up).
  BACKUP_KEEP_N: z.coerce.number().int().min(0).default(10),
  // M17 — Absolute or cwd-relative directory where mysqldump|gzip
  // output is written. Created on first backup if absent. Path is
  // resolved relative to process.cwd() at bootServer() time.
  BACKUP_DIR: z.string().default('./backups'),
  // M25 — Cron cadence for the daily report. The tick fires only when
  // the current UTC time is 00:00..00:04, so picking a cadence that
  // gives the scheduler exactly ONE chance inside that 5-minute window
  // prevents duplicate sends. Default 5min = 1 hit/day; 30min also safe.
  EMAIL_DAILY_REPORT_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60_000),
  // M25 — Cron cadence for the weekly report. Fires on Monday
  // 00:10..00:14 UTC. Default 60min = 1 hit/week inside the window.
  EMAIL_WEEKLY_REPORT_INTERVAL_MS: z.coerce.number().int().positive().default(60 * 60_000),
  // M25 — Optional override for the SMTP_FROM header. Used by the
  // "send test" button so admins can verify a specific sender identity.
  EMAIL_FROM_DEFAULT: z.string().email().optional(),
});

type ParsedEnv = z.infer<typeof schema>;

/**
 * M28.bug9: validation is LAZY. Route files transitively pull `@/lib/config/env`
 * even when they don't actually read any field at request time — Next.js's
 * build-time page-data collection step then triggers the Zod parse, which
 * throws ZodError on DATABASE_URL before init has had a chance to write .env.
 *
 * The previous `schema.parse(process.env)` at module top fired the moment any
 * module imported `env`. Replacing it with a Proxy defers parsing until the
 * first property access (i.e. the moment the running code actually needs the
 * value). Routes that never touch `env.DATABASE_URL` build fine; routes that
 * do touch it still get the same validation guarantee at runtime.
 *
 * Trade-off: the parsed object is cached after the first parse, so process.env
 * changes at runtime are NOT picked up. That's the same as before — restart
 * for env changes.
 *
 * M28.api-settings — `invalidateEnvCache()` lets the admin UI's
 * /admin/api-settings page write to .env and force a re-read on the
 * next access. The running process still keeps the old values
 * (e.g. an active scheduler tick) — the cache only affects NEW reads.
 * Operators must restart the server to actually pick up the new
 * values in the long-running scheduler / pool.
 */
let cached: ParsedEnv | null = null;
function parse(): ParsedEnv {
  if (cached) return cached;
  cached = schema.parse(process.env);
  return cached;
}

/** Clear the in-process env cache. Call after writing to .env so
 *  subsequent `env.X` reads see the new value. */
export function invalidateEnvCache(): void {
  cached = null;
}

export const env = new Proxy({} as ParsedEnv, {
  get(_t, prop: string | symbol) {
    const value = parse();
    return value[prop as keyof ParsedEnv];
  },
  has(_t, prop: string | symbol) {
    return prop in parse();
  },
  ownKeys() {
    return Reflect.ownKeys(parse());
  },
  getOwnPropertyDescriptor(_t, prop) {
    const value = parse();
    return Object.getOwnPropertyDescriptor(value, prop);
  },
}) as ParsedEnv & { [k: string]: unknown };

export type Env = ParsedEnv;
