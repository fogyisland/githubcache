/**
 * M28.bug4b — dev DB schema-drift detector.
 *
 * Thin CLI wrapper around `checkDrift()` in
 * `src/lib/database/drift-check.ts`. The library does the actual
 * comparison work; this script just formats the result for the
 * terminal and exits non-zero on drift so it can be used in CI.
 *
 * Run ad-hoc: `npm run db:check-drift`
 * Wired into dev:server boot via `src/lib/database/startup.ts`.
 *
 * Coverage note: only catches rebuilds AFTER the most recent migration.
 * See the library file for the full rationale and limitations.
 */

import { prisma } from '@/lib/db/client';
import { checkDrift, DRIFT_CHECK_TABLES } from '@/lib/database/drift-check';

async function main(): Promise<void> {
  const result = await checkDrift();

  if (result.error !== null) {
    console.error(`✗ drift check failed: ${result.error}`);
    process.exit(1);
  }

  if (result.noMigrations) {
    console.error(
      '✗ no migrations recorded in _prisma_migrations. ' +
        'Run `npx prisma migrate deploy` first.',
    );
    process.exit(1);
  }

  console.log(
    `Last applied migration finished_at: ${result.lastFinishedAt!.toISOString()}`,
  );
  console.log(`Drift grace window: ${result.graceMin} minutes`);
  console.log(
    `Connection: DATABASE()=${result.database ?? '?'}; tablesScanned=${result.tablesScanned} of ${DRIFT_CHECK_TABLES.length} expected`,
  );
  console.log('');

  if (result.healthy.length > 0) {
    console.log('✓ healthy (CREATE_TIME within grace window):');
    for (const n of result.healthy) console.log(`  - ${n}`);
  }

  if (result.missing.length > 0) {
    console.error('');
    console.error(
      `✗ ${result.missing.length} expected table(s) not found in the current schema:`,
    );
    for (const n of result.missing) console.error(`  - ${n}`);
    console.error(
      'Did the migration that creates this table fail, or is your connection pointed at the wrong schema?',
    );
    process.exit(1);
  }

  if (result.drifted.length > 0) {
    console.error('');
    console.error(
      `✗ ${result.drifted.length} table(s) appear to have been rebuilt OUTSIDE prisma migrate:`,
    );
    for (const d of result.drifted) {
      console.error(
        `  - ${d.name}: CREATE_TIME=${d.createTime.toISOString()} ` +
          `(drift ${d.driftMin}m after last migration)`,
      );
    }
    console.error('');
    console.error(
      'Likely causes: `prisma db push`, raw DROP+CREATE SQL, or a ' +
        'backup restored without re-running newer migrations.',
    );
    console.error(
      'This is the failure mode that disabled 3 admin accounts on ' +
        '2026-09-07 with no audit trail. Fix the DB before trusting it.',
    );
    process.exit(1);
  }

  console.log('');
  console.log('✓ no drift detected.');
}

void main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e: unknown) => {
    console.error('db-drift-check failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
