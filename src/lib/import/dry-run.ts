import type { Pool, RowDataPacket } from 'mysql2/promise';
import { prisma } from '@/lib/db/client';
import {
  TABLE_SCHEMAS,
  type ColumnSpec,
  type ImportableTable,
} from '@/lib/import/tables';

/**
 * Result of a dry-run for a single table. Counts are upper bounds:
 * `willInsert` is the count of source rows whose natural unique key is
 * NOT already present in the target; `willSkip` is the count of source
 * rows whose unique key IS present; `willFail` is reserved for FK
 * violations (e.g., a `repo_releases` row whose `repositoryId` doesn't
 * exist in the target's `repositories`).
 */
export type DryRunResult = {
  table: ImportableTable;
  willInsert: number;
  willSkip: number;
  willFail: number;
  /** Up to 5 sample rows from the source, projected for display. */
  sampleRows: unknown[];
};

const SAMPLE_SIZE = 5;

/**
 * Run a dry-run for one table.
 *
 * Steps:
 *   1. Read all source rows from the pool (capped by maxRows).
 *   2. Compute the unique-key composite for each source row.
 *   3. Look up existing target rows that share those keys.
 *   4. willSkip = rows whose key exists in target.
 *      willInsert = rows whose key is missing.
 *   5. For child tables (repo_releases / repo_branches), willFail =
 *      rows whose repositoryId is not present in target.repositories.
 *
 * Designed to be cheap: a single source SELECT + a single target
 * findMany. No writes.
 */
export async function dryRunImport(args: {
  sourcePool: Pool;
  table: ImportableTable;
  maxRows?: number;
}): Promise<DryRunResult> {
  const { sourcePool, table } = args;
  const maxRows = args.maxRows ?? 1000;
  const schema = TABLE_SCHEMAS[table];

  // 1. Read source rows. We use the full column list, not SELECT *,
  // so the projection matches `columns` and we don't accidentally
  // leak FK helpers or computed columns in sampleRows.
  const columnList = schema.columns.map((c) => `\`${c.column}\``).join(', ');
  const [rows] = await sourcePool.query<RowDataPacket[]>(
    `SELECT ${columnList} FROM \`${table}\` LIMIT ${maxRows}`,
  );

  if (rows.length === 0) {
    return { table, willInsert: 0, willSkip: 0, willFail: 0, sampleRows: [] };
  }

  // 2 + 3. Compute unique keys and look up existing target rows.
  const uniqueKeys = schema.uniqueKeys;
  const existingKeys = await findExistingKeys(table, uniqueKeys, rows);

  // 4. Tally willSkip / willInsert.
  let willInsert = 0;
  let willSkip = 0;
  for (const row of rows) {
    const k = uniqueKey(row, uniqueKeys, schema.columns);
    if (existingKeys.has(k)) willSkip++;
    else willInsert++;
  }

  // 5. Child-table FK integrity check.
  let willFail = 0;
  if (table === 'repo_releases' || table === 'repo_branches') {
    const sourceRepoIds = new Set<bigint>();
    for (const row of rows) {
      const v = row['repository_id'];
      if (v === null || v === undefined) continue;
      sourceRepoIds.add(BigInt(v as string | number | bigint));
    }
    if (sourceRepoIds.size > 0) {
      const ids = [...sourceRepoIds];
      const target = await prisma.repository.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const targetIds = new Set(target.map((r) => r.id));
      for (const row of rows) {
        const v = row['repository_id'];
        if (v === null || v === undefined) continue;
        const id = BigInt(v as string | number | bigint);
        if (!targetIds.has(id)) willFail++;
      }
    }
  }

  return {
    table,
    willInsert,
    willSkip,
    willFail,
    sampleRows: rows.slice(0, SAMPLE_SIZE).map((r) =>
      projectRowForDisplay(r, schema.columns),
    ),
  };
}

/** Build a deterministic unique-key string for a single source row. */
function uniqueKey(
  row: RowDataPacket,
  uniqueKeys: string[],
  columns: ColumnSpec[],
): string {
  const parts = uniqueKeys.map((field) => {
    const col = columns.find((c) => c.field === field);
    if (col === undefined) {
      throw new Error(`unique key field '${field}' not in column list`);
    }
    const v = row[col.column];
    return v === null || v === undefined ? '\0' : String(v);
  });
  return parts.join('\x1f');
}

/**
 * Find which composite keys from the source batch already exist in the
 * target. Single query per table — we OR together the unique-field
 * predicates for each source key so MySQL can use the index.
 *
 * Caller is responsible for the unique-key cardinality being small
 * (<= `maxRows`). If you pass 10k rows you'll build a 10k-deep OR
 * clause; that's still bounded by `maxRows` in dry-run, which is the
 * only entry point.
 */
async function findExistingKeys(
  table: ImportableTable,
  uniqueKeys: string[],
  rows: RowDataPacket[],
): Promise<Set<string>> {
  if (rows.length === 0) return new Set();

  const schema = TABLE_SCHEMAS[table];
  const fieldCols = uniqueKeys.map((field) => {
    const col = schema.columns.find((c) => c.field === field);
    if (col === undefined) {
      throw new Error(`unique key field '${field}' not in column list`);
    }
    return col;
  });

  // Build an OR-of-ANDs clause. Each source row contributes one AND
  // group; the whole thing is wrapped in an outer OR.
  const conditions: string[] = [];
  const values: unknown[] = [];
  for (const row of rows) {
    const parts: string[] = [];
    for (const col of fieldCols) {
      parts.push(`\`${col.column}\` = ?`);
      const v = row[col.column];
      values.push(col.jsType === 'bigint' && v !== null && v !== undefined
        ? BigInt(v as string | number | bigint)
        : v);
    }
    conditions.push(`(${parts.join(' AND ')})`);
  }

  const sql = `SELECT ${fieldCols.map((c) => `\`${c.column}\``).join(', ')} FROM \`${table}\` WHERE ${conditions.join(' OR ')}`;
  const target = await prisma.$queryRawUnsafe<RowDataPacket[]>(sql, ...values);

  // Build the same composite key string for each returned row.
  const found = new Set<string>();
  for (const row of target) {
    found.add(uniqueKey(row, uniqueKeys, schema.columns));
  }
  return found;
}

/** Project a raw row into a JSON-friendly shape for display in the UI. */
function projectRowForDisplay(
  row: RowDataPacket,
  columns: ColumnSpec[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    const v = row[col.column];
    if (v instanceof Date) {
      out[col.field] = v.toISOString();
    } else if (col.jsType === 'bigint') {
      out[col.field] = v === null || v === undefined ? null : String(v);
    } else if (Buffer.isBuffer(v)) {
      out[col.field] = v.toString('utf8');
    } else {
      out[col.field] = v;
    }
  }
  return out;
}