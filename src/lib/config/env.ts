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
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
