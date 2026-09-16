import { NextResponse } from 'next/server';
import { collectV1Status } from '@/lib/api-docs/v1-status';
import { v1StatusSchema } from '@/lib/api-docs/schemas/v1-status';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/logger';
import { apiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const status = await collectV1Status();
  if (status === null) {
    // DB unreachable. The route always returns the full V1Status shape on
    // 503 (same as the healthy path) so downstream consumers see a single
    // well-typed contract. The `ok: false` + `db: 'down'` fields are the
    // signals.
    const degraded = {
      ok: false,
      db: 'down' as const,
      database: null,
      drift: null,
      tokens: { active: 0, exhausted: 0, total: 0, source: 'db' },
      queue: { pending: 0, in_progress: 0, done: 0, failed: 0 },
      repositories: { total: 0, ok: 0, not_found: 0, forbidden: 0, error: 0 },
      scheduler: {
        paused: true,
        // M30.7c — still expose the env-derived scheduler config so
        // dashboards can render the expected cadence even when DB is
        // down. Without these, v1StatusSchema.safeParse fails and the
        // route falls through to a 500 internal_error (the previous bug).
        tick_ms: env.SCHEDULER_TICK_MS,
        batch_size: env.SCHEDULER_BATCH_SIZE,
      },
      version: {
        commit: process.env.GIT_COMMIT ?? 'unknown',
        startedAt: new Date(0).toISOString(),
        nodeVersion: process.version,
      },
      timestamp: new Date().toISOString(),
    };
    const parsed = v1StatusSchema.safeParse(degraded);
    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues }, 'status payload schema mismatch');
      return apiError('internal_error', 'internal');
    }
    return NextResponse.json(parsed.data, { status: 503 });
  }
  const parsed = v1StatusSchema.safeParse(status);
  if (!parsed.success) {
    logger.error({ issues: parsed.error.issues }, 'status payload schema mismatch');
    return apiError('internal_error', 'internal');
  }
  return NextResponse.json(parsed.data, { status: 200 });
}
