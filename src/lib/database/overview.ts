import { prisma } from '@/lib/db/client';
import { env } from '@/lib/config/env';

export interface DatabaseOverview {
  /** MySQL version string, e.g. "8.0.36". */
  version: string;
  /** Database name extracted from DATABASE_URL (no password). */
  databaseName: string;
  /** Host from DATABASE_URL (no password). */
  host: string;
  /** Port from DATABASE_URL. */
  port: number;
  /** Sum of data_length + index_length across all tables in this DB,
   * in bytes. From information_schema.tables. */
  totalBytes: number;
  /** Sum across all tables in this DB. */
  tableCount: number;
}

export interface TableStat {
  /** Prisma model name (camelCase) e.g. "RequestLog". */
  model: string;
  /** Real table name (snake_case) e.g. "request_log". */
  table: string;
  /** Approximate row count from information_schema. */
  rowCount: number;
  /** data_length + index_length, in bytes. */
  bytes: number;
}

/**
 * M17 — Read DB version, current DB name + host (password stripped),
 * and total disk footprint across all tables.
 */
export async function getDatabaseOverview(): Promise<DatabaseOverview> {
  const versionRows = await prisma.$queryRaw<Array<{ v: string }>>`SELECT VERSION() AS v`;
  const version = versionRows[0]?.v ?? 'unknown';
  const dbName = parseDbName(env.DATABASE_URL ?? '') ?? 'unknown';
  const host = parseHost(env.DATABASE_URL ?? '');
  const port = Number(parsePort(env.DATABASE_URL ?? ''));

  // Sum across all tables in the current DB
  const agg = await prisma.$queryRaw<Array<{ total: bigint | null; tables: bigint }>>`
    SELECT COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH), 0) AS total,
           COUNT(*) AS tables
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ${dbName}
  `;
  const total = agg[0]?.total ?? 0n;
  const tables = agg[0]?.tables ?? 0n;

  return {
    version,
    databaseName: dbName,
    host,
    port,
    totalBytes: Number(total),
    tableCount: Number(tables),
  };
}

/**
 * M17 — Per-table row counts + size, in display order (largest first).
 *
 * The Prisma model → table name mapping is hand-maintained so we
 * don't pull the entire Prisma Client's introspection API. If a new
 * model is added it MUST also be added here, or it'll show up as
 * `null` in the table list.
 */
const MODEL_TO_TABLE: ReadonlyArray<{ model: string; table: string }> = [
  { model: 'Repository', table: 'repositories' },
  { model: 'User', table: 'users' },
  { model: 'ApiKey', table: 'api_keys' },
  { model: 'AuditLog', table: 'audit_log' },
  { model: 'RequestLog', table: 'request_log' },
  { model: 'GithubToken', table: 'github_tokens' },
  { model: 'RefreshJob', table: 'refresh_jobs' },
  { model: 'Session', table: 'sessions' },
  { model: 'Invitation', table: 'invitations' },
  { model: 'RateLimitBucket', table: 'rate_limit_buckets' },
  { model: 'IpRateLimitBucket', table: 'ip_rate_limit_buckets' },
  { model: 'WebhookSubscription', table: 'webhook_subscriptions' },
  { model: 'WebhookDelivery', table: 'webhook_deliveries' },
];

export async function getTableStats(): Promise<TableStat[]> {
  const dbName = parseDbName(env.DATABASE_URL ?? '');
  if (!dbName) return [];
  const rows = await prisma.$queryRaw<
    Array<{ TABLE_NAME: string; TABLE_ROWS: bigint | null; DATA_LENGTH: bigint; INDEX_LENGTH: bigint }>
  >`
    SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ${dbName}
  `;
  const byName = new Map(rows.map((r) => [r.TABLE_NAME, r]));

  // Build the display list in the model order above; tables that exist
  // in the DB but not in MODEL_TO_TABLE get appended at the end.
  const out: TableStat[] = [];
  const seen = new Set<string>();
  for (const { model, table } of MODEL_TO_TABLE) {
    const r = byName.get(table);
    seen.add(table);
    if (r) {
      out.push({
        model,
        table,
        rowCount: Number(r.TABLE_ROWS ?? 0n),
        bytes: Number(r.DATA_LENGTH + r.INDEX_LENGTH),
      });
    } else {
      // Table declared in schema but missing from DB (fresh migration
      // never ran) — surface so admin notices.
      out.push({ model, table, rowCount: 0, bytes: 0 });
    }
  }
  for (const r of rows) {
    if (!seen.has(r.TABLE_NAME)) {
      out.push({
        model: '(unknown)',
        table: r.TABLE_NAME,
        rowCount: Number(r.TABLE_ROWS ?? 0n),
        bytes: Number(r.DATA_LENGTH + r.INDEX_LENGTH),
      });
    }
  }
  out.sort((a, b) => b.bytes - a.bytes);
  return out;
}

function parseDbName(url: string): string | null {
  const m = /\/\/[^/]+\/([^?]+)/.exec(url);
  return m?.[1] ?? null;
}
function parseHost(url: string): string {
  const m = /@([^:/]+)/.exec(url);
  return m?.[1] ?? '127.0.0.1';
}
function parsePort(url: string): string {
  const m = /:(\d+)\//.exec(url);
  return m?.[1] ?? '3306';
}
