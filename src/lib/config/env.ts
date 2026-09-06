import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
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

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
