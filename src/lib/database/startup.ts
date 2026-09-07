import { logger } from '@/lib/logger';
import { checkBinaries } from '@/lib/database/binary-check';
import { checkDrift } from '@/lib/database/drift-check';

/**
 * Run at bootServer() (called from src/server.ts). Logs warnings for any
 * pre-flight failures but never throws — the rest of the app may still
 * serve traffic. Tests rely on `bootServer()` succeeding under
 * NODE_ENV=test even if mysqldump is missing or the test DB has drift.
 *
 * Failure modes surfaced here:
 *   - missing mysqldump / gzip binaries (M17) — backup page disabled
 *   - schema drift: a table's CREATE_TIME is later than the most recent
 *     migration's finished_at (M28.bug4b) — strongly suggests the DB
 *     was rebuilt out-of-band and is now inconsistent with migration
 *     history. Warn loudly; operators should run
 *     `npm run db:check-drift` for the full diagnosis. We intentionally
 *     do NOT fail-fast at boot, because the smoketest in
 *     tests/integration/server-boot.test.ts shares the dev DB and
 *     legitimate drift from prior debugging sessions shouldn't block
 *     boot. The script is the fail-fast path.
 */
export async function startupDatabaseChecks(): Promise<void> {
  const result = await checkBinaries();
  if (!result.mysqldump.available) {
    logger.warn(
      { err: result.mysqldump.error },
      'mysqldump not on PATH — DB backup/restore disabled in admin',
    );
  }
  if (!result.gzip.available) {
    logger.warn(
      { err: result.gzip.error },
      'gzip not on PATH — DB backup/restore disabled in admin',
    );
  }
  if (result.mysqldump.available && result.gzip.available) {
    logger.info(
      {
        mysqldump: result.mysqldump.version,
        gzip: result.gzip.version,
      },
      'database backup binaries available',
    );
  }

  const drift = await checkDrift();
  if (drift.error !== null) {
    logger.warn(
      { err: drift.error, database: drift.database },
      'schema-drift check could not run; DB may be unreachable. Run `npm run db:check-drift` for details.',
    );
  } else if (drift.noMigrations) {
    logger.warn(
      { database: drift.database },
      'schema-drift check found no applied migrations. Run `npx prisma migrate deploy` before serving traffic.',
    );
  } else if (!drift.ok) {
    logger.warn(
      {
        database: drift.database,
        lastMigration: drift.lastFinishedAt?.toISOString(),
        graceMin: drift.graceMin,
        tablesScanned: drift.tablesScanned,
        missing: drift.missing,
        drifted: drift.drifted.map((d) => ({
          table: d.name,
          createTime: d.createTime.toISOString(),
          driftMin: d.driftMin,
        })),
      },
      'DB schema drift detected: tables rebuilt outside prisma migrate. ' +
        'Audit trail may be missing. Run `npm run db:check-drift` for full diagnosis.',
    );
  } else {
    logger.info(
      {
        database: drift.database,
        lastMigration: drift.lastFinishedAt?.toISOString(),
        graceMin: drift.graceMin,
        tablesScanned: drift.tablesScanned,
        tablesHealthy: drift.healthy.length,
      },
      'schema-drift check passed',
    );
  }
}
