import { prisma } from '@/lib/db/client';

/**
 * M28.bug4b — DB schema-drift detection.
 *
 * Detects the silent "dev DB rebuilt without going through prisma migrate"
 * failure mode that we hit on 2026-09-07: users/refresh_jobs/repositories
 * had CREATE_TIME values later than the most recent applied migration,
 * meaning someone DROP+CREATE'd those tables outside Prisma's tracking.
 * No audit trail, no warning — the schema just stopped matching the
 * migration history and 3 admin accounts ended up disabled without any
 * audit row pointing at the cause.
 *
 * Compares:
 *   - The most recent `_prisma_migrations.finished_at` timestamp
 *   - The `CREATE_TIME` of every user-data table in information_schema
 *
 * If a table's CREATE_TIME is later than the most recent migration by
 * more than the grace window (default 5 minutes, configurable via
 * DRIFT_GRACE_MIN env), the result.drifted[] lists each offender. The
 * caller decides whether to fail-fast (CLI script), log warning
 * (server boot), or fail tests (CI).
 *
 * Coverage note: only catches rebuilds AFTER the most recent migration.
 * Rebuilds that pre-date newer migrations but happen to leave the schema
 * consistent won't trip this check. The audit_log / trigger path is the
 * primary defense against those historical gaps.
 *
 * The check is read-only — it only SELECTs from _prisma_migrations and
 * information_schema. No DDL.
 */

// Tables we care about — these were the 3 affected on 2026-09-07.
// Extend if a new table gets the silent-rebuild treatment.
export const DRIFT_CHECK_TABLES = [
  'users',
  'repositories',
  'refresh_jobs',
  'audit_log',
  'api_keys',
  'sessions',
  'github_tokens',
  'invitations',
  'webhook_subscriptions',
  'webhook_deliveries',
  'ingestion_providers',
  'rate_limit_buckets',
  'ip_rate_limit_buckets',
  'email_log',
  'email_config',
  'repo_releases',
  'repo_branches',
] as const;

const DEFAULT_GRACE_MIN = 5;

interface MigrationRow {
  finished_at: Date | null;
}
interface TableRow {
  TABLE_NAME: string;
  CREATE_TIME: Date;
}

export interface DriftedTable {
  name: string;
  createTime: Date;
  driftMin: number;
}

export interface DriftResult {
  ok: boolean;
  /** Set when _prisma_migrations has no finished rows (fresh DB / un-migrated). */
  noMigrations: boolean;
  /** Last applied migration's finished_at. null when noMigrations. */
  lastFinishedAt: Date | null;
  /** Effective grace window applied (minutes). */
  graceMin: number;
  /** DATABASE() the check ran against. Useful when connection string has
   *  a default schema different from what the operator expected. */
  database: string | null;
  /** Total rows information_schema returned. Useful to catch the
   *  "Prisma tagged template treated DATABASE() as a parameter" bug. */
  tablesScanned: number;
  /** Tables from DRIFT_CHECK_TABLES that the DB doesn't have at all
   *  (CREATE_TIME doesn't exist because the table doesn't exist). */
  missing: string[];
  drifted: DriftedTable[];
  healthy: string[];
  /** Error message when the check could not run at all (DB unreachable etc). */
  error: string | null;
}

/**
 * Run the schema-drift check against the current Prisma-connected database.
 *
 * Pure read: no side effects on the DB or the Prisma client. Safe to call
 * from CLI scripts, server startup, and tests. Does not disconnect — the
 * caller owns the Prisma client lifecycle.
 */
export async function checkDrift(
  graceMin: number = Number(process.env['DRIFT_GRACE_MIN'] ?? DEFAULT_GRACE_MIN),
): Promise<DriftResult> {
  try {
    const lastMigration = await prisma.$queryRaw<MigrationRow[]>`
      SELECT finished_at FROM _prisma_migrations
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC LIMIT 1
    `;
    const lastFinishedAt = lastMigration[0]?.finished_at ?? null;

    if (lastFinishedAt === null) {
      return {
        ok: false,
        noMigrations: true,
        lastFinishedAt: null,
        graceMin,
        database: await currentDatabase(),
        tablesScanned: 0,
        missing: [],
        drifted: [],
        healthy: [],
        error: 'no migrations recorded in _prisma_migrations',
      };
    }

    // Use $queryRawUnsafe so DATABASE() is passed as a raw SQL token.
    // Prisma's $queryRaw tagged template literal treats DATABASE() as
    // a parameter binding, which yields zero rows — we hit this exact
    // bug on the first dev:server boot and the log showed
    // tablesScanned: 0 even though the DB clearly had 3+ tables.
    const tables = (await prisma.$queryRawUnsafe(`
      SELECT TABLE_NAME, CREATE_TIME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${DRIFT_CHECK_TABLES.map((t) => `'${t}'`).join(',')})
      ORDER BY TABLE_NAME
    `)) as TableRow[];

    const graceMs = graceMin * 60 * 1000;
    const drifted: DriftedTable[] = [];
    const healthy: string[] = [];
    const missing: string[] = [];

    // Detect expected tables that did not show up in information_schema
    // — those count as "missing", not "healthy", so we surface them
    // loudly instead of silently skipping.
    const foundNames = new Set(tables.map((t) => t.TABLE_NAME));
    for (const expected of DRIFT_CHECK_TABLES) {
      if (!foundNames.has(expected)) {
        missing.push(expected);
      }
    }

    for (const t of tables) {
      const driftMs = t.CREATE_TIME.getTime() - lastFinishedAt.getTime();
      if (driftMs > graceMs) {
        drifted.push({
          name: t.TABLE_NAME,
          createTime: t.CREATE_TIME,
          driftMin: Math.round(driftMs / 60_000),
        });
      } else {
        healthy.push(t.TABLE_NAME);
      }
    }

    return {
      ok: drifted.length === 0 && missing.length === 0,
      noMigrations: false,
      lastFinishedAt,
      graceMin,
      database: await currentDatabase(),
      tablesScanned: tables.length,
      missing,
      drifted,
      healthy,
      error: null,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      noMigrations: false,
      lastFinishedAt: null,
      graceMin,
      database: null,
      tablesScanned: 0,
      missing: [],
      drifted: [],
      healthy: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Returns the schema name of the current connection (DATABASE()). */
async function currentDatabase(): Promise<string | null> {
  try {
    const rows = (await prisma.$queryRawUnsafe(
      'SELECT DATABASE() AS db',
    )) as { db: string }[];
    return rows[0]?.db ?? null;
  } catch {
    return null;
  }
}
