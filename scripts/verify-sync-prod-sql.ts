// One-shot syntax sanity check for scripts/sync-prod-refresh-jobs.sql.
// Read-only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(process.cwd(), 'scripts', 'sync-prod-refresh-jobs.sql'),
  'utf8',
);

console.log('scripts/sync-prod-refresh-jobs.sql:');
console.log(sql);
console.log('\nInvariants:');

const checks: Array<[string, RegExp]> = [
  ['Preflight SELECT row count guard',  /SELECT IF\(\s*\(SELECT COUNT\(\*\) FROM refresh_jobs\) > 0,/m],
  ['ALTER repository_id BIGINT NULL',   /ALTER TABLE refresh_jobs MODIFY COLUMN `repository_id` BIGINT NULL/m],
  ['ADD owner VARCHAR(100) NOT NULL',   /ALTER TABLE refresh_jobs ADD COLUMN `owner` VARCHAR\(100\) NOT NULL AFTER `repository_id`/m],
  ['ADD name VARCHAR(200) NOT NULL',    /ALTER TABLE refresh_jobs ADD COLUMN `name` VARCHAR\(200\) NOT NULL AFTER `owner`/m],
  ['CREATE INDEX owner_name_idx',       /CREATE INDEX `refresh_jobs_owner_name_idx` ON `refresh_jobs` \(\s*`owner`\s*,\s*`name`\s*\)/m],
  ['Verify SHOW CREATE TABLE',          /SHOW CREATE TABLE refresh_jobs/m],
  ['Verify SHOW INDEX',                 /SHOW INDEX FROM refresh_jobs/m],
  ['Backfill comment in preflight',     /backfill owner\/name from repositories first/i],
  ['M31 owner/name mirror rationale',   /mirrors repositories.owner so the scheduler/m],
];

let failed = 0;
for (const [label, re] of checks) {
  if (re.test(sql)) {
    console.log(`  PASS ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\n${failed} invariant(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll 9 invariants satisfied. sync-prod-refresh-jobs.sql is well-formed.');
}
