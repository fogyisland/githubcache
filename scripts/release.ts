/**
 * Build a release artifact under `release/githubcache/`.
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
 *   - dist/  (legacy dist/ output dir, if any)
 *   - release/  (this script's own output — MUST be excluded, otherwise
 *                each run copies the previous release tree into itself,
 *                nesting `release/githubcache/release/githubcache/...`)
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

// M28.bug16 — server runs npm ci + npm run build itself (node_modules and
// .next contain too many small files to ship). env.ts is now tolerant of
// missing DATABASE_URL at build time, so build succeeds without any stub.
//
// What ships:
//   - source tree (src, prisma, messages, scripts, public)
//   - .env.example (template; init copies this to .env on first run)
//
// What does NOT ship:
//   - .env (secrets — written by wizard on first deploy)
//   - .next, node_modules (recipient runs npm ci + npm run build)
const EXCLUDE_DIRS = new Set([
  '.git',
  '.next',
  'node_modules',
  'coverage',
  'test-results',
  '.superpowers',
  '.claude',
  '.github',
  'tests',
  'docs',
  'dist',
  'release',     // M28.bug27 — exclude this script's own output to prevent
                 // the matryoshka (release/githubcache/release/githubcache/...)
  'backups',
  // M32.6.3 — root-level scratch / debug dirs that crept in during local
  // debugging. None of these are needed for the recipient to run the app.
  // M32.7.1 — these are root-level only; see ROOT_ONLY_EXCLUDE_DIRS below.
  'CLA',
  'reports',
  'testgit',
  'testjson',
  'test',        // ad-hoc shell scripts + dumps, not vitest (which lives in tests/)
  // scripts/ subdirs that hold dev-only utilities, not deploy-time tools.
  'migrations',  // scripts/migrations/ — backfill helpers (e.g. backfill-pending-jobs.ts)
  'test-ignore-schema',
]);

// M32.7.1 — Dirs in EXCLUDE_DIRS that share names with legitimate src/
// subdirs. These are root-level only and must NOT exclude their src/
// lookalikes. The only collision today is `reports/` (root-level dev
// logs) vs `src/lib/reports/` (real code). If more collisions appear,
// add them here. Other root-level scratch dirs (CLA, testgit, testjson,
// test, migrations, test-ignore-schema) are kept in EXCLUDE_DIRS only
// and excluded at any depth — they don't collide with src/ subdirs.
const ROOT_ONLY_EXCLUDE_DIRS = new Set([
  'reports',
]);

const EXCLUDE_FILES = new Set([
  '.env',
  '.env.production',
  '.env.production.local',
  '.env.development',
  '.env.development.local',
  '.env.local',
  '.env.backup',
  '.env.test',
  '.env.tmp',
  'tsconfig.tsbuildinfo',
  'verify.ts',
]);

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
  // M32.6.3 — dev-only debug / verification / smoke / repro scripts. These
  // were useful during local development but the recipient has no use for
  // them; shipping them bloats the artifact and clutters the script dir.
  'debug-admin-header.mjs',
  'debug-csrf-headers.mjs',
  'debug-keys-request.mjs',
  'debug-keys-request-2.mjs',
  'debug-login-flow.mjs',
  'debug-prisma-query.mjs',
  'debug-refresh-jobs-prisma.mjs',
  'debug-refresh-jobs-schema.mjs',
  'debug-rotate-button.mjs',
  'debug-rotate-button-2.mjs',
  'debug-seed-admin.mts',
  'e2e-api-fixture-verify.mjs',
  'gen-fixture-repos.mjs',
  'inspect-error-page.mjs',
  'query-100-repos.mjs',
  'repro-login-404.mjs',
  'smoke-50-repos.mjs',
  'test-client-omit.mjs',
  'test-default-findmany.mjs',
  'test-query-omit.mjs',
  'verify-admin-pages.mjs',
  'verify-btn-primary-fix.mjs',
  'verify-bug17-baseline.mjs',
  'verify-bug17-fix.mjs',
  'verify-flat-fix.mjs',
  'verify-init-schema.ts',
  'verify-list-actions.mjs',
  'verify-list-actions-via-curl.mjs',
  'verify-shield-active.mjs',
  'verify-sync-prod-sql.ts',
  // ad-hoc probes / dev-box utilities — none belong on a deploy target.
  'probe-login.mjs',
  'probe-providers.mjs',
  'probe-providers2.mjs',
  'probe-users.mjs',
  'probe-ports.ps1',
  'probe-status.ps1',
  'port-free.ps1',
  'kill-all-node.ps1',
  'kill-pid-15540.ps1',
  'kill-port-5002.ps1',
  'kill-port.ps1',
  'kill-server-38036.ps1',
  'restart-dev-server.ps1',
  'wait-for-port.ps1',
  'dev-fresh.cjs',
  'dev-fresh.ps1',
  'dev-fresh.sh',
  'next15-await-cookies.mjs',
  'admin-smoke.mjs',
  'admin-smoke-m30-8.mjs',
  'setup-smoke-users.mjs',
  'trace-api-data.mjs',
  'seed-test-key.mjs',
  'seed-token.mjs',
  'load-100.mjs',
  'delete-flat-fix-fixtures.mjs',
  'install-status-trigger.mjs',
  'audit-admin.mjs',
  'add-token.mjs',
  // one-shot prod-sync SQL the recipient doesn't need on first deploy —
  // they would only use these if migrating from an older version, and
  // we ship a release note per-version explaining when to run them.
  'sync-prod-api-keys-plaintext.sql',
  'sync-prod-refresh-jobs.sql',
]);

// Top-level src/app subdirs that are debug surfaces, not production routes.
const APP_EXCLUDE = new Set([
  // M32.6.3 — api-demo was a temporary page to inspect API responses
  // during M30 development; it has no production audience.
  'api-demo',
]);

// -----------------------------------------------------------------------------
// File collection
// -----------------------------------------------------------------------------

function shouldExclude(absPath: string, name: string, prefix: string): boolean {
  const parts = prefix.split(/[\\/]+/).filter(Boolean);
  // Path-aware guard: dirs that share names with src/ subdirs must only
  // be excluded when they actually live at the repo root. Without this,
  // `src/lib/reports/` (legitimate source) is incorrectly skipped
  // because the root-level `reports/` scratch dir (dev logs, debug PNGs)
  // shares its name. The build then fails on the server with
  // "Module not found: @/lib/reports/ingestion" etc.
  if (EXCLUDE_DIRS.has(name) && ROOT_ONLY_EXCLUDE_DIRS.has(name) && parts.length === 0) return true;
  if (EXCLUDE_DIRS.has(name) && !ROOT_ONLY_EXCLUDE_DIRS.has(name)) return true;
  if (EXCLUDE_FILES.has(name)) return true;
  if (SCRIPT_EXCLUDE.has(name) && absPath.includes(`${'\\'}scripts${'\\'}`)) return true;
  // APP_EXCLUDE keys are checked against the parent path normalized to
  // forward slashes (so the rule works on both Windows and POSIX).
  if (APP_EXCLUDE.has(name) && parts.join('/') === 'src/app') return true;
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
      if (shouldExclude(abs, entry, prefix)) continue;
      out.push(...walk(abs, rel));
    } else if (st.isFile()) {
      if (shouldExclude(abs, entry, prefix)) continue;
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
  // M32.7.4 — prominent warning block BEFORE the TL;DR. Previous cloud
  // deploys ran `npm start` (Next.js only — no scheduler, no pool) and
  // wondered why refresh_jobs never drained. This block makes the right
  // command unmissable. Layer 7 in package.json also adds a `prestart`
  // trap that aborts `npm start` at runtime; this doc is the
  // human-facing counterpart.
  const startWarning = `> **⚠ DO NOT run \`npm start\` — it skips the scheduler + GitHub token pool.**
>
> \`npm start\` runs \`next start\` only. Your \`refresh_jobs\` backlog will never
> drain and \`/api/v1/repos\` will return 503 even with tokens configured.
> Use \`npm run start:server\` (or \`NODE_ENV=production npm run start:server\`)
> for any production deployment. The \`prestart\` script in package.json
> also aborts \`npm start\` at runtime with this same message.

`;
  return `# githubcache v${VERSION} — deploy guide

This release artefact contains a clean source tree of githubcache v${VERSION},
ready to initialise and start on a fresh server.

${startWarning}## TL;DR

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
  - \`SCHEDULER_TICK_MS\`  default 60000 — \`lockSetupSubtask\` writes 1000 on first init so the shipped artifact drains at ~1 req/sec out of the box
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
  console.log(`  npm run build       # ALWAYS delete .next first if upgrading:`);
  console.log(`                     #   rm -rf .next && npm run build`);
  console.log(`                     # Stale .next/ chunks can ship react-dom.development`);
  console.log(`                     # and cause React 'startTime' render errors in the browser.`);
  console.log(`  NODE_ENV=production npm run start:server`);
  console.log(`  # Browser: hard-refresh (Ctrl+Shift+R) to clear stale chunks`);
}

main();