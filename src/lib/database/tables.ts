import { prisma } from '@/lib/db/client';
import { env } from '@/lib/config/env';

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface TableDetail {
  table: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  rowCount: number;
  bytes: number;
}

const TARGET_TABLES = [
  'repositories',
  'users',
  'api_keys',
  'audit_log',
  'request_log',
  'github_tokens',
  'refresh_jobs',
  'sessions',
  'invitations',
  'rate_limit_buckets',
  'ip_rate_limit_buckets',
  'webhook_subscriptions',
  'webhook_deliveries',
] as const;

/**
 * M17 — Fetch schema metadata for every Prisma-mapped table. Used by
 * the /admin/database tables-section. One round-trip per table for
 * columns + indexes (information_schema queries — no DDL needed).
 */
export async function getTableDetails(): Promise<TableDetail[]> {
  const dbName = parseDbName(env.DATABASE_URL ?? '');
  if (!dbName) return [];

  // Fetch stats + columns + indexes in parallel per table. With 13
  // tables that's 13 * 2 = 26 queries; on a local MySQL this is sub-100ms.
  const out: TableDetail[] = [];
  for (const table of TARGET_TABLES) {
    const [columns, indexes, stats] = await Promise.all([
      fetchColumns(dbName, table),
      fetchIndexes(dbName, table),
      fetchStats(dbName, table),
    ]);
    out.push({
      table,
      columns,
      indexes,
      rowCount: stats.rowCount,
      bytes: stats.bytes,
    });
  }
  return out;
}

async function fetchColumns(db: string, table: string): Promise<ColumnInfo[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      IS_NULLABLE: 'YES' | 'NO';
      COLUMN_KEY: string;
    }>
  >`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ${db} AND TABLE_NAME = ${table}
    ORDER BY ORDINAL_POSITION
  `;
  return rows.map((r) => ({
    name: r.COLUMN_NAME,
    dataType: r.DATA_TYPE,
    nullable: r.IS_NULLABLE === 'YES',
    isPrimaryKey: r.COLUMN_KEY === 'PRI',
  }));
}

async function fetchIndexes(db: string, table: string): Promise<IndexInfo[]> {
  const rows = await prisma.$queryRaw<
    Array<{ INDEX_NAME: string; COLUMN_NAME: string; NON_UNIQUE: number; SEQ_IN_INDEX: number }>
  >`
    SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = ${db} AND TABLE_NAME = ${table}
    ORDER BY INDEX_NAME, SEQ_IN_INDEX
  `;
  const byIdx = new Map<string, IndexInfo>();
  for (const r of rows) {
    let entry = byIdx.get(r.INDEX_NAME);
    if (!entry) {
      entry = { name: r.INDEX_NAME, columns: [], unique: r.NON_UNIQUE === 0 };
      byIdx.set(r.INDEX_NAME, entry);
    }
    entry.columns.push(r.COLUMN_NAME);
  }
  return Array.from(byIdx.values());
}

async function fetchStats(
  db: string,
  table: string,
): Promise<{ rowCount: number; bytes: number }> {
  const rows = await prisma.$queryRaw<
    Array<{ TABLE_ROWS: bigint | null; DATA_LENGTH: bigint; INDEX_LENGTH: bigint }>
  >`
    SELECT TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ${db} AND TABLE_NAME = ${table}
  `;
  const r = rows[0];
  if (!r) return { rowCount: 0, bytes: 0 };
  return {
    rowCount: Number(r.TABLE_ROWS ?? 0n),
    bytes: Number(r.DATA_LENGTH + r.INDEX_LENGTH),
  };
}

function parseDbName(url: string): string | null {
  const m = /\/\/[^/]+\/([^?]+)/.exec(url);
  return m?.[1] ?? null;
}
