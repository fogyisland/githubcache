// One-shot invariant checker for the refresh_jobs CREATE TABLE statement
// in src/lib/db/init-schema.ts. Read-only: never touches the DB.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(process.cwd(), 'src', 'lib', 'db', 'init-schema.ts'),
  'utf8',
);

// Walk forward from the start marker, tracking paren depth, to extract
// the full refresh_jobs CREATE TABLE statement.
const startMarker = 'CREATE TABLE IF NOT EXISTS \\`refresh_jobs\\`';
const start = src.indexOf(startMarker);
if (start < 0) {
  // debug: search for similar substrings
  const alt1 = src.indexOf('CREATE TABLE IF NOT EXISTS');
  console.error('"CREATE TABLE IF NOT EXISTS" first at index', alt1);
  console.error('snippet:', JSON.stringify(src.substring(alt1, alt1 + 80)));
  throw new Error('refresh_jobs statement not found');
}

let depth = 0;
let inString: string | null = null;
let escape = false;
let end = -1;
for (let i = start; i < src.length; i++) {
  const c = src[i];
  if (escape) { escape = false; continue; }
  if (c === '\\') { escape = true; continue; }
  if (inString) {
    if (c === inString) inString = null;
    continue;
  }
  if (c === "'" || c === '"' || c === '`') { inString = c; continue; }
  if (c === '(') depth++;
  else if (c === ')') {
    depth--;
    if (depth === 0) {
      const rest = src.substring(i + 1).trimStart();
      if (rest.startsWith('DEFAULT CHARACTER SET')) {
        end = i + 1;
        break;
      }
    }
  }
}
if (end < 0) throw new Error('Could not find end of refresh_jobs CREATE TABLE');

const stmt = src.substring(start, end).trim().replace(/\\`/g, '`');
console.log('refresh_jobs CREATE TABLE statement (unescaped):');
console.log(stmt);
console.log('\nInvariants:');

const checks: Array<[string, RegExp]> = [
  ['owner column VARCHAR(100) NOT NULL', /^\s*`owner`\s+VARCHAR\(100\)\s+NOT NULL/m],
  ['name column VARCHAR(200) NOT NULL',  /^\s*`name`\s+VARCHAR\(200\)\s+NOT NULL/m],
  ['repository_id BIGINT NULL (M31)',    /^\s*`repository_id`\s+BIGINT\s+NULL/m],
  ['refresh_jobs_owner_name_idx',        /INDEX\s+`refresh_jobs_owner_name_idx`\s*\(\s*`owner`\s*,\s*`name`\s*\)/],
  ['FK to repositories(id)',             /CONSTRAINT\s+`refresh_jobs_repository_id_fkey`[\s\S]+REFERENCES\s+`repositories`\(\s*`id`\s*\)/],
  ['id column AUTO_INCREMENT',           /^\s*`id`\s+BIGINT\s+NOT NULL\s+AUTO_INCREMENT/m],
  ['job_kind ENUM',                      /`job_kind`\s+ENUM\('core','releases','branches'\)/],
  ['priority INT',                       /`priority`\s+INT\s+NOT NULL/],
  ['status ENUM',                        /`status`\s+ENUM\('pending','in_progress','done','failed'\)/],
  ['created_at DATETIME(3)',             /`created_at`\s+DATETIME\(3\)\s+NOT NULL/],
  ['updated_at with ON UPDATE',          /`updated_at`[\s\S]+ON UPDATE CURRENT_TIMESTAMP\(3\)/],
  ['status_scheduled_for_idx',           /refresh_jobs_status_scheduled_for_idx/],
  ['status_priority_idx',                /refresh_jobs_status_priority_idx/],
];

let failed = 0;
for (const [label, re] of checks) {
  if (re.test(stmt)) {
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
  console.log('\nAll 13 invariants satisfied. New CREATE TABLE matches M31 schema.prisma + preserves pre-M31 columns.');
}
