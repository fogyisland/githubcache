/**
 * Build a release artifact under `dist/release/vX.Y.Z/githubcache-vX.Y.Z/`.
 *
 * What gets shipped (clean source tree, no dev artefacts):
 *   - package.json + package-lock.json
 *   - tsconfig.json, next.config.mjs, eslint.config.mjs, tailwind.config.ts,
 *     postcss.config.mjs, playwright.config.ts, vitest.config.ts
 *   - prisma/  (schema + all migrations — required for `prisma migrate deploy`)
 *   - messages/ (en.json + zh.json)
 *   - src/  (server.ts + app/ + lib/)
 *   - scripts/  (init.ts + bootstrap helpers; smoke + dev-fetch excluded)
 *   - public/  (Next.js static assets if present)
 *   - .env.example
 *   - CHANGELOG.md, README.md, CLAUDE.md  (operator reference)
 *   - RELEASE.md (this script writes a one-pager for the recipient)
 *
 * What is excluded:
 *   - .git/, .next/, node_modules/, coverage/, test-results/
 *   - tests/, docs/, .superpowers/, tsconfig.tsbuildinfo
 *   - *.log, *.bak, *.tmp
 *   - .env  (secrets — never ship)
 *   - dist/  (this output directory)
 *
 * Usage:
 *   npm run release                        # uses package.json version
 *   npm run release -- --version 0.2.0     # override
 *
 * Output (single directory, no tarball — ship as-is):
 *   release/githubcache/      (clean source tree, copy to server)
 *
 * Deploy flow the recipient follows (in RELEASE.md):
 *   1. Copy githubcache/ to the server (rsync, scp, USB, ...)
 *   2. cd githubcache
 *   3. npm ci --omit=dev
 *   4. npx prisma generate
 *   5. NODE_ENV=production npm run start:server
 *   6. Visit https://<your-domain>/init in a browser — collect DB credentials,
 *      admin email/password; runs migrate deploy + bootstraps admin + locks /init
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'release');

// -----------------------------------------------------------------------------
// CLI / version
// -----------------------------------------------------------------------------

const args = process.argv.slice(2);
const versionOverrideIdx = args.indexOf('--version');
const VERSION = versionOverrideIdx >= 0 && args[versionOverrideIdx + 1]
  ? args[versionOverrideIdx + 1]
  : (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

// -----------------------------------------------------------------------------
// Excludes — never ship these
// -----------------------------------------------------------------------------

const EXCLUDE_DIRS = new Set([
  '.git',
  '.next',
  'node_modules',
  'coverage',
  'test-results',
  '.superpowers',
  'tests',
  'docs',
  'dist',
  'backups',
]);

const EXCLUDE_FILES = new Set([
  '.env',
  '.env.backup',
  '.env.test',
  '.env.tmp',
  '.env.local',
  'tsconfig.tsbuildinfo',
  'verify.ts',
]);

// M28.bug10 — `.env.production` IS shipped. It contains a syntactically
// valid DATABASE_URL stub so `npm run build` can run as a code/package
// sanity check on a freshly-extracted release, before `npm run init`
// has had a chance to write the real .env. The stub values are placeholders;
// no real credentials live in this file. The release script does NOT need
// to special-case it because .env.production does NOT appear in EXCLUDE_FILES.

const EXCLUDE_GLOBS_RE = [
  /\.log$/,
  /\.bak$/,
  /\.tmp$/,
  /~$/,
  /\.DS_Store$/,
];

// Scripts that are only useful on a dev workstation — not for the recipient.
const SCRIPT_EXCLUDE = new Set([
  'dev-fetch.ts',        // uses local fixtures
  'm21-smoke-provider.ts', // throws when no admin session
  'smoke-session.ts',     // needs a live session cookie
  'list-providers.ts',   // admin utility, not deploy-time
]);

// -----------------------------------------------------------------------------
// File collection
// -----------------------------------------------------------------------------

function shouldExclude(absPath: string, name: string): boolean {
  if (EXCLUDE_DIRS.has(name)) return true;
  if (EXCLUDE_FILES.has(name)) return true;
  if (SCRIPT_EXCLUDE.has(name) && absPath.includes(`${'\\'}scripts${'\\'}`)) return true;
  return EXCLUDE_GLOBS_RE.some((re) => re.test(name));
}

interface CollectedFile {
  src: string;
  dest: string;
}

function walk(dir: string, prefix: string): CollectedFile[] {
  const out: CollectedFile[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = join(dir, entry);
    const rel = join(prefix, entry);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (shouldExclude(abs, entry)) continue;
      out.push(...walk(abs, rel));
    } else if (st.isFile()) {
      if (shouldExclude(abs, entry)) continue;
      out.push({ src: abs, dest: rel });
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// RELEASE.md (recipient-facing one-pager)
// -----------------------------------------------------------------------------

function buildReleaseNotes(files: CollectedFile[]): string {
  const scriptFiles = files.filter((f) => f.dest.startsWith('scripts' + '/')).map((f) => f.dest);
  return `# githubcache v${VERSION} — deploy guide

This release artefact contains a clean source tree of githubcache v${VERSION},
ready to initialise and start on a fresh server.

## TL;DR

Copy the \`githubcache/\` directory to the server (rsync, scp,
USB — whatever you have), then run:

\`\`\`bash
cd githubcache
npm ci --omit=dev
NODE_ENV=production npm run start:server
\`\`\`

Then open the service in a browser. The middleware redirects every
request to \`/init\` until the wizard completes. The wizard (3 steps):

  1. **DB credentials** — host / port / user / password / database name.
     Server probes the TCP port to confirm a MySQL daemon is listening,
     then writes \`DATABASE_URL\` to \`.env\`. The schema is auto-created
     if missing.
  2. **Admin account** — email + password (≥ 8 chars). Server hashes the
     password (bcrypt) and upserts the user with role=admin.
  3. **Run migrations** — \`prisma migrate deploy\` creates all tables,
     then \`ghc_setup_done=1\` cookie is set for 10 years. \`/init\` is
     locked from this point on; the middleware bounces any future hit
     to \`/\`.

The service listens on \`PORT\` (default \`5002\`).

## Environment variables

Required (init will prompt or read from your shell env):
  - \`DATABASE_URL\`       MySQL connection string (Prisma format)
  - \`SESSION_SECRET\`     ≥32 chars — auto-generated if missing/placeholder

Optional (all have sensible defaults in \`src/lib/config/env.ts\`):
  - \`PORT\`               default 5002
  - \`NODE_ENV\`           set to \`production\`
  - \`LOG_LEVEL\`          \`info\` for prod, \`debug\` for local
  - \`SCHEDULER_TICK_MS\`  default 60000 (1s in dev only)
  - \`SCHEDULER_*_SWEEP_HOURS\`  per-facet cadence (M27.5)
  - \`BACKUP_DIR\`, \`BACKUP_KEEP_N\`  (M17)
  - \`EMAIL_DAILY_REPORT_INTERVAL_MS\`, etc.  (M25)
  - See \`/docs/deployment\` for the full env-var table.

## What this release contains

  - **Source**: \`src/\` (Next.js app + server entry + library)
  - **Database**: \`prisma/schema.prisma\` + every migration in \`prisma/migrations/\`
  - **i18n**: \`messages/en.json\` + \`messages/zh.json\`
  - **Bootstrap scripts** (\`scripts/\`):
${scriptFiles.map((s) => `    - \`${s}\``).join('\n')}
  - **Static assets**: \`public/\`
  - **Reference docs**: \`README.md\`, \`CHANGELOG.md\`, \`CLAUDE.md\`

## What is NOT in this release

  - \`.git/\`, \`.next/\`, \`node_modules/\` — deploy step rebuilds these
  - \`tests/\`, \`docs/\`, \`.superpowers/\` — dev-only, not needed to run
  - \`.env\` — secrets must be provisioned separately per environment

## Post-deploy admin actions

The init script handles the schema and admin user. Two things still need
manual provisioning via the admin UI (or an external secret manager):

1. **GitHub tokens** — visit \`/admin/github-tokens\` and paste at least 2 PATs.
   Until you do, the GitHub token pool is empty and \`/api/v1/repos\` returns 503.

2. **SMTP** (optional) — visit \`/admin/email\` and configure your relay. Without
   it, signup + key approval flows run but the user never gets the email.

## Smoke test (after init + start)

\`\`\`bash
curl http://localhost:5002/api/v1/status
curl http://localhost:5002/docs/api/v1-status
\`\`\`

Both should return 200. \`/api/v1/status\` JSON should report
\`down: false\`, \`tokens.active ≥ 1\`, and \`repositories.total > 0\` once
the scheduler has had ~60s to populate the cache.

## Rollback

Migrations are forward-only. To roll back the app: redeploy the previous
release directory. To roll back the schema: write a follow-up migration that
restores the affected columns / tables — there is no automatic reverse.

## Reference

  - Project home: https://github.com/fogyisland/githubcache
  - Operator runbook: see \`README.md\` and \`/docs/deployment\` (online)
`;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

function main(): void {
  const releaseDirName = 'githubcache';
  const releaseDir = join(DIST, releaseDirName);

  console.log(`Building release v${VERSION}`);
  console.log(`  → ${releaseDir}`);

  // Collect files first so we know the count for the manifest.
  const files = walk(ROOT, '');
  console.log(`  ${files.length} files to copy`);

  // Ensure parent dir exists (idempotent re-runs).
  mkdirSync(dirname(releaseDir), { recursive: true });

  // Copy each file into the release tree.
  let copied = 0;
  for (const f of files) {
    const targetPath = join(releaseDir, f.dest);
    mkdirSync(dirname(targetPath), { recursive: true });
    const content = readFileSync(f.src);
    writeFileSync(targetPath, content);
    copied++;
  }
  console.log(`  copied ${copied} files`);

  // Write the recipient-facing release notes inside the tree.
  writeFileSync(join(releaseDir, 'RELEASE.md'), buildReleaseNotes(files));
  console.log(`  wrote RELEASE.md`);

  console.log(`\nRelease ready. Ship the directory:`);
  console.log(`  rsync -av --delete release/${releaseDirName}/  user@server:/opt/${releaseDirName}/`);
  console.log(`\nOn the server:`);
  console.log(`  cd ${releaseDirName}`);
  console.log(`  npm ci --omit=dev`);
  console.log(`  NODE_ENV=production npm run start:server`);
  console.log(`  # then visit /init in a browser`);
}

main();