import { logger } from '@/lib/logger';
import { checkBinaries } from '@/lib/database/binary-check';

/**
 * M17 — Run at bootServer() (called from src/server.ts). Logs a warning
 * if mysqldump / gzip are missing but never fails the boot — the rest
 * of the app does not depend on them.
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
}
