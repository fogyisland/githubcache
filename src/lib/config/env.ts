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
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_TOKENS: z.string().optional(),
  GITHUB_TOKENS_FILE: z.string().optional(),
  SCHEDULER_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(60_000),
  NIGHTLY_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(24 * 60 * 60_000),
  SCHEDULER_ENABLED: z.coerce.boolean().default(true),
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
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
