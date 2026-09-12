import { prisma } from '@/lib/db/client';

export interface EtaInputs {
  queueDepth: number;
  tickMs: number;
  batchSize: number;
  medianFetchMs: number;
  now?: Date;
}

/**
 * M30.7c — Pure ETA estimator for cache-miss responses.
 *
 * Formula:
 *   ticksUntilMine  = ceil(queueDepth / batchSize) + (queueDepth === batchSize ? 1 : 0)
 *   fetchMs         = medianFetchMs > 0 ? medianFetchMs : tickMs
 *   expected_at     = now + ticksUntilMine * tickMs + fetchMs
 *
 * The boundary rule handles the case where the current batch is exactly
 * full (queueDepth === batchSize): our job spills into the next batch.
 *
 * Fallback medianFetchMs=0 (no history yet) → use tickMs, giving a total
 * estimate of 2 ticks (1 tick queue wait + 1 tick fetch).
 */
export function estimateExpectedAt(inputs: EtaInputs): Date {
  const now = inputs.now ?? new Date();
  const { queueDepth, tickMs, batchSize, medianFetchMs } = inputs;
  // Defensive: bad inputs still produce a usable future Date.
  const safeTick = tickMs > 0 ? tickMs : 60_000;
  const safeBatch = batchSize > 0 ? batchSize : 10;
  const safeDepth = Math.max(1, Math.floor(queueDepth));
  const baseTicks = Math.ceil(safeDepth / safeBatch);
  const boundaryExtra = safeDepth === safeBatch ? 1 : 0;
  const ticksUntilMine = baseTicks + boundaryExtra;
  const fetchMs = medianFetchMs > 0 ? medianFetchMs : safeTick;
  return new Date(now.getTime() + ticksUntilMine * safeTick + fetchMs);
}

/**
 * M30.7c — Count currently-pending refresh_jobs. Includes jobs in any state
 * 'pending' (in_progress jobs are already past the tick gate, so they're
 * effectively in the current batch's fetch window). Caller counts the new
 * job separately.
 */
export async function getQueueDepth(): Promise<number> {
  return prisma.refreshJob.count({ where: { status: 'pending' } });
}

/**
 * M30.7c — Median (updatedAt - createdAt) over refresh_jobs.status=done
 * within the last 24h. Falls back to 0 when there is no history — caller
 * then uses the tickMs fallback in estimateExpectedAt.
 *
 * Uses a single SQL aggregation rather than pulling rows to Node — done
 * jobs in a busy install can be in the thousands.
 */
export async function getMedianFetchMs(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ median_ms: number | null }>>(
    `SELECT TIMESTAMPDIFF(MICROSECOND, MIN(createdAt), MAX(updatedAt)) /
            NULLIF(COUNT(*), 0) / 1000 AS median_ms
       FROM refresh_jobs
      WHERE status = 'done'
        AND updatedAt >= (NOW() - INTERVAL 24 HOUR)`,
  );
  const v = rows[0]?.median_ms;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}
