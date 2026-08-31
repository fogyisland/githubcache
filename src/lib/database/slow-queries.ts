import { prisma } from '@/lib/db/client';

export interface SlowQueryRow {
  digest: string;
  calls: number;
  totalSeconds: number;
  avgSeconds: number;
  rowsSent: number;
  sampleSql: string;
}

export type SlowQueriesResult =
  | { kind: 'ok'; rows: SlowQueryRow[] }
  | { kind: 'no_permission'; reason: string };

/**
 * M17 — Top N slow query digests from performance_schema. Requires the
 * MySQL user to have the PROCESS privilege (or be the root user) for
 * performance_schema.events_statements_summary_by_digest to be
 * readable. Most managed MySQL providers (RDS, Cloud SQL) restrict
 * this — we degrade gracefully when the SELECT fails with a
 * permission error and the page shows a hint instead.
 */
export async function topSlowQueries(limit = 20): Promise<SlowQueriesResult> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        DIGEST: string;
        COUNT_STAR: bigint;
        SUM_TIMER_WAIT: bigint;
        AVG_TIMER_WAIT: bigint;
        SUM_ROWS_SENT: bigint;
        DIGEST_TEXT: string | null;
      }>
    >`
      SELECT SCHEMA_NAME AS _sc, /* placeholder for grouping not used */
             DIGEST,
             COUNT_STAR,
             SUM_TIMER_WAIT,
             AVG_TIMER_WAIT,
             SUM_ROWS_SENT,
             DIGEST_TEXT
      FROM performance_schema.events_statements_summary_by_digest
      WHERE SCHEMA_NAME IS NOT NULL
        AND SCHEMA_NAME = DATABASE()
      ORDER BY SUM_TIMER_WAIT DESC
      LIMIT ${limit}
    `;

    return {
      kind: 'ok',
      rows: rows.map((r) => ({
        digest: r.DIGEST,
        calls: Number(r.COUNT_STAR),
        totalSeconds: Number(r.SUM_TIMER_WAIT) / 1e12, // picoseconds → seconds
        avgSeconds: Number(r.AVG_TIMER_WAIT) / 1e12,
        rowsSent: Number(r.SUM_ROWS_SENT),
        sampleSql: r.DIGEST_TEXT ?? '',
      })),
    };
  } catch (e: unknown) {
    // Most likely cause: SELECT denied on performance_schema.
    // Code 1227 (ER_SPECIFIC_ACCESS_DENIED_ERROR) is the canonical
    // signature; we don't gate on it strictly — any throw becomes a
    // degraded view to keep the page from going red.
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: 'no_permission', reason: msg };
  }
}
