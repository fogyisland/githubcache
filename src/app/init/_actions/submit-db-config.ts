'use server';

import { z } from 'zod';
import { testDbConnection, writeSetupEnv, buildDatabaseUrl } from '@/lib/setup';
import { logger } from '@/lib/logger';

const DbConfigSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1).max(64),
  password: z.string().max(128),
  database: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/, '数据库名只能包含字母、数字、下划线'),
});

/**
 * Server action: test the candidate DB config, write .env on success.
 *
 * Returns a discriminated union so the form can show the MySQL error
 * verbatim. We do NOT redirect from the server action — the form does
 * router.push('/init/admin') on `ok` so it stays in control of the
 * navigation flow (and shows its own pending state until navigation).
 *
 * Prisma connection pool is NOT touched here — we use mysql2/promise
 * directly for the probe so a wrong config doesn't crash the shared
 * client. The next request after writeSetupEnv re-creates the pool
 * from the new DATABASE_URL via env.ts's lazy Proxy.
 */
export interface SubmitDbConfigResult {
  ok: boolean;
  error?: string;
  wouldWrite?: string;
}

export async function submitDbConfig(input: unknown): Promise<SubmitDbConfigResult> {
  const parsed = DbConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const cfg = parsed.data;
  let result;
  try {
    result = await testDbConnection(cfg);
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'init: db probe crashed');
    return { ok: false, error: (e as Error).message };
  }
  if (!result.ok) {
    return { ok: false, error: result.error ?? '连接失败', wouldWrite: result.wouldWrite };
  }
  try {
    writeSetupEnv(buildDatabaseUrl(cfg));
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'init: write .env failed');
    return { ok: false, error: `写入 .env 失败：${(e as Error).message}` };
  }
  return { ok: true, wouldWrite: result.wouldWrite };
}