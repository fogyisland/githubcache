import type { Pool, RowDataPacket } from 'mysql2/promise';
import { prisma } from '@/lib/db/client';
import {
  TABLE_SCHEMAS,
  type ImportableTable,
} from '@/lib/import/tables';

export type ApplyResult = {
  table: ImportableTable;
  inserted: number;
  skipped: number;
  failed: number;
};

/**
 * Hard cap per apply. Keeps the worst-case workload bounded and
 * matches the `422 import_too_large` contract documented in the spec.
 */
export const MAX_ROWS_PER_APPLY = 10_000;

/** In-process mutex so two concurrent applies on the same target
 * can't both succeed against the same source. The key is the source
 * database host+name (a globally-unique identifier for the source);
 * different sources run in parallel. */
const inFlight = new Map<string, Promise<ApplyResult[]>>();

/**
 * Apply INSERT IGNORE for one or more tables.
 *
 * For each table:
 *   1. Read source rows (capped by MAX_ROWS_PER_APPLY).
 *   2. Project to Prisma createMany payload (convert MySQL row shapes
 *      to Prisma input).
 *   3. `prisma.createMany({ skipDuplicates: true })` — this is the
 *      MySQL `INSERT IGNORE` analogue on Prisma 5.x.
 *
 * Audit is written by the route handler, NOT here — apply.ts has no
 * access to the actor user.
 */
export async function applyImport(args: {
  sourcePool: Pool;
  tables: ImportableTable[];
  sourceKey: string;
  maxRows?: number;
}): Promise<ApplyResult[]> {
  const { sourcePool, tables, sourceKey } = args;
  const maxRows = args.maxRows ?? MAX_ROWS_PER_APPLY;

  const existing = inFlight.get(sourceKey);
  if (existing !== undefined) {
    // Single-flight: the second caller gets the same Promise. Caller
    // can choose to render the result or treat it as "import in
    // progress".
    return existing;
  }

  const promise = (async (): Promise<ApplyResult[]> => {
    const out: ApplyResult[] = [];
    for (const table of tables) {
      const result = await applyOne(sourcePool, table, maxRows);
      out.push(result);
    }
    return out;
  })();
  inFlight.set(sourceKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(sourceKey);
  }
}

async function applyOne(
  sourcePool: Pool,
  table: ImportableTable,
  maxRows: number,
): Promise<ApplyResult> {
  const schema = TABLE_SCHEMAS[table];
  const columnList = schema.columns.map((c) => `\`${c.column}\``).join(', ');
  const [rows] = await sourcePool.query<RowDataPacket[]>(
    `SELECT ${columnList} FROM \`${table}\` LIMIT ${maxRows}`,
  );

  if (rows.length === 0) {
    return { table, inserted: 0, skipped: 0, failed: 0 };
  }

  // Project rows to the Prisma model payload.
  const data = rows.map((r) => projectToPrisma(r, table));

  try {
    // @prisma/client 5.22 supports skipDuplicates for MySQL 5.7+.
    // Prisma's prisma client doesn't expose a generic string indexer,
    // so cast through unknown to the model-shape we know each table's
    // TABLE_SCHEMAS entry provides.
    const modelClient = (prisma as unknown as Record<string, {
      createMany: (args: { data: unknown[]; skipDuplicates: boolean }) => Promise<{ count: number }>;
    }>)[schema.modelName];
    if (modelClient === undefined) {
      // TABLE_SCHEMAS invariant: every entry's modelName maps to a
      // real Prisma model. If we ever drift, fail loud.
      throw new Error(`[import] no Prisma model for ${schema.modelName}`);
    }
    const res = await modelClient.createMany({ data, skipDuplicates: true });

    const inserted = res.count;
    const skipped = rows.length - inserted;
    return { table, inserted, skipped, failed: 0 };
  } catch (e) {
    // Top-level failure (e.g., FK violation, schema mismatch). The
    // caller treats this as a hard failure for this table; other
    // tables still get applied.
    const message = e instanceof Error ? e.message : 'unknown error';
    // Log so the operator can see which rows failed without us
    // silently swallowing.
    console.error(`[import] apply failed for ${table}:`, message);
    return { table, inserted: 0, skipped: 0, failed: rows.length };
  }
}

/**
 * Map a raw mysql2 row to the Prisma model input.
 *
 * - Date columns → Date instance (Prisma serialises to MySQL DATETIME).
 * - Json columns → already JS values; cast to Prisma.InputJsonValue.
 * - bigint columns → BigInt (mysql2 returns number for BIGINT by
 *   default; re-cast to BigInt so Prisma's BigInt fields match).
 * - Boolean/number → already JS primitives.
 */
function projectToPrisma(
  row: RowDataPacket,
  table: ImportableTable,
): Record<string, unknown> {
  const schema = TABLE_SCHEMAS[table];
  const out: Record<string, unknown> = {};
  for (const col of schema.columns) {
    const v = row[col.column];
    if (v === null || v === undefined) {
      out[col.field] = null;
      continue;
    }
    if (col.jsType === 'date') {
      out[col.field] = v instanceof Date ? v : new Date(v as string);
    } else if (col.jsType === 'bigint') {
      out[col.field] = typeof v === 'bigint' ? v : BigInt(v as string | number);
    } else if (col.jsType === 'json') {
      out[col.field] = v;
    } else if (col.jsType === 'boolean') {
      out[col.field] = Boolean(v);
    } else if (col.jsType === 'number') {
      out[col.field] = Number(v);
    } else {
      out[col.field] = v;
    }
  }
  return out;
}