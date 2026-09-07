/**
 * Bootstrap script — runs the full first-time setup in one command.
 *
 *   npm run init                       # interactive
 *   npm run init -- --non-interactive   # CI/automation: admin@example.com / auto PAT from env
 *   npm run init -- --reset-admin      # also reset the existing admin's password
 *
 * What it does (idempotent — safe to run multiple times):
 *   1. Ensures .env exists (copies .env.example), writes a fresh random
 *      SESSION_SECRET if it's missing or still on the placeholder default
 *   2. Verifies DATABASE_URL is set and the MySQL connection works
 *   3. Auto-runs `npx prisma migrate deploy` so a fresh DB lands on the
 *      latest schema (replaces the prior "check + warn" behavior — the
 *      deploy script needs the schema to exist before step 4 queries it)
 *   4. Creates / promotes the bootstrap admin user
 *   5. Optionally registers a GitHub PAT (skipped if pool already has 1+ active)
 *   6. Optionally seeds a starter ingestion provider (skipped if any exist)
 *   7. Optionally seeds a starter repository (M27 demo) so the cache isn't empty
 *   8. Prints a summary: URL, login creds, next steps
 *
 * This complements `scripts/create-admin.ts` (which only handles step 4) and
 * `scripts/mint-local-api-key.ts` (API key only). Use this when you need the
 * whole server up — fresh VM, new clone, post-disaster rebuild.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// M28.bug5 — these imports depend on @/lib/config/env which validates
// process.env at module load. We MUST NOT load them before ensureEnvFile()
// runs, otherwise a fresh deploy with no .env crashes on import with a
// confusing ZodError instead of the friendly "DATABASE_URL not set".
// `loadAppModules()` does the dynamic import after .env is in place, then
// assigns the singletons to module-level `let`s so the rest of the script
// can use them without changing every call site.
let prisma!: import('@prisma/client').PrismaClient;
let hashPassword!: (pw: string) => Promise<string>;
let logger!: { error: (...args: unknown[]) => void };

async function loadAppModules(): Promise<void> {
  if (prisma) return;
  const [db, auth, log] = await Promise.all([
    import('@/lib/db/client'),
    import('@/lib/auth/password'),
    import('@/lib/logger'),
  ]);
  prisma = db.prisma;
  hashPassword = auth.hashPassword;
  logger = log.logger;
}

// -----------------------------------------------------------------------------
// CLI flag parsing
// -----------------------------------------------------------------------------

const args = process.argv.slice(2);
const NON_INTERACTIVE = args.includes('--non-interactive');
const RESET_ADMIN = args.includes('--reset-admin');

interface Config {
  siteName: string;
  adminEmail: string;
  adminPassword: string;
  githubToken: string | null;
  seedProvider: boolean;
}

function envFlag(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

// -----------------------------------------------------------------------------
// Step helpers
// -----------------------------------------------------------------------------

function section(title: string): void {
  const bar = '─'.repeat(Math.max(0, 60 - title.length - 2));
  console.log(`\n── ${title} ${bar}`);
}

async function prompt(question: string, defaultValue: string, sensitive = false): Promise<string> {
  if (NON_INTERACTIVE) return defaultValue;
  const rl = readline.createInterface({ input, output });
  try {
    const suffix = defaultValue ? ` [${sensitive ? '********' : defaultValue}]` : '';
    const answer = await rl.question(`${question}${suffix}: `);
    return answer.trim() || defaultValue;
  } finally {
    rl.close();
  }
}

async function promptYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  if (NON_INTERACTIVE) return defaultYes;
  const rl = readline.createInterface({ input, output });
  try {
    const hint = defaultYes ? 'Y/n' : 'y/N';
    const answer = (await rl.question(`${question} [${hint}]: `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer.startsWith('y');
  } finally {
    rl.close();
  }
}

// -----------------------------------------------------------------------------
// Step 0: Ensure .env exists with a real SESSION_SECRET
// -----------------------------------------------------------------------------
//
// M28.bug5 — init used to only check migrations; a fresh DB or empty `.env`
// required manual setup before the app could boot. We now:
//   - copy .env.example → .env if .env is missing
//   - regenerate SESSION_SECRET if it's missing or still on the placeholder
//     ('replace-with-32-chars-min-secret' / 'dev-secret-change-me-...')
//
// DATABASE_URL is intentionally NOT auto-filled — it's a per-environment
// credential that the operator must provide (interactive prompt or env var).

const PLACEHOLDER_SECRETS = new Set([
  'replace-with-32-chars-min-secret',
  'dev-secret-change-me-32-chars-min-aaaaa',
]);

function generateSessionSecret(): string {
  // 48 hex chars (24 random bytes) — comfortably above the 32-char floor.
  return randomBytes(24).toString('hex');
}

function upsertEnvLine(content: string, key: string, value: string): string {
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((l) => new RegExp(`^${key}=`).test(l));
  const newLine = `${key}=${value}`;
  if (idx >= 0) {
    lines[idx] = newLine;
  } else {
    // Insert before the first blank-line / comment block to keep .env.example's
    // grouping (env vars on top, comments below).
    const insertAt = lines.findIndex((l) => l.trim() === '' || l.trim().startsWith('#'));
    if (insertAt >= 0) {
      lines.splice(insertAt, 0, newLine);
    } else {
      lines.push(newLine);
    }
  }
  return lines
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === '')) // dedupe trailing blanks
    .join('\n')
    .replace(/^\n+/, '')
    .concat('\n');
}

function ensureEnvFile(): void {
  section('0 · .env bootstrap');

  if (!existsSync('.env')) {
    if (existsSync('.env.example')) {
      copyFileSync('.env.example', '.env');
      console.log('✓ copied .env.example → .env');
    } else {
      throw new Error('.env.example is missing — cannot bootstrap .env');
    }
  } else {
    console.log('✓ .env already exists');
  }

  // Reload .env so subsequent steps see the (possibly just-written) values.
  // node --env-file=.env picks these up at process start, but process.env
  // was already snapshotted before we wrote — patch it in by hand.
  const content = readFileSync('.env', 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!m || !m[1] || m[2] === undefined) continue;
    const key = m[1];
    const rawValue = m[2];
    if (process.env[key] === undefined) {
      process.env[key] = rawValue;
    }
  }

  // Regenerate SESSION_SECRET if it's the placeholder or missing.
  const current = process.env['SESSION_SECRET'];
  if (!current || PLACEHOLDER_SECRETS.has(current)) {
    const fresh = generateSessionSecret();
    process.env['SESSION_SECRET'] = fresh;
    const updated = upsertEnvLine(content, 'SESSION_SECRET', fresh);
    writeFileSync('.env', updated);
    console.log(`✓ SESSION_SECRET was placeholder → wrote fresh (${fresh.length} chars)`);
  } else {
    console.log(`✓ SESSION_SECRET already set (${current.length} chars)`);
  }
}

// -----------------------------------------------------------------------------
// Step 1: DB connection
// -----------------------------------------------------------------------------

async function checkDatabase(): Promise<void> {
  section('1 · Database connection');
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  }
  // Parse host (no creds in output) just for the log line.
  const host = url.replace(/^mysql:\/\/[^@]+@/, 'mysql://***@');
  // SELECT 1 round-trip via Prisma. Throws on failure.
  await prisma.$queryRaw`SELECT 1 AS ok`;
  console.log(`✓ reachable: ${host}`);
}

// -----------------------------------------------------------------------------
// Step 2: Run pending Prisma migrations
// -----------------------------------------------------------------------------
//
// M28.bug5 — replaces the old `checkMigrations()` which only warned. The
// deploy pipeline needs the schema to exist before step 4 queries it, so
// we now run `prisma migrate deploy` directly. If the DB is empty, this
// creates _prisma_migrations and applies everything in order.
//
// Per CLAUDE.md: migrations still run as a separate step from app startup
// (a failed migration here aborts the init — the app never starts), but
// it's the deploy script's job to invoke this, not the application's.

function runMigrations(): void {
  section('2 · Prisma migrations');
  // shell: true so Windows can resolve npx.cmd (npx is a .cmd shim on
  // Windows; without shell, spawnSync returns exit=null with no output).
  const result = spawnSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed (exit ${result.status})`);
  }
  console.log('✓ migrations applied');
}

// -----------------------------------------------------------------------------
// Step 3: Admin user
// -----------------------------------------------------------------------------

async function bootstrapAdmin(cfg: Config): Promise<void> {
  section('3 · Admin user');
  const existing = await prisma.user.findUnique({ where: { email: cfg.adminEmail } });
  const passwordHash = await hashPassword(cfg.adminPassword);

  if (existing && !RESET_ADMIN) {
    if (existing.role === 'admin' && existing.status === 'active') {
      console.log(`✓ already exists: ${cfg.adminEmail} (admin/active) — login with your existing password`);
      return;
    }
    // Promote to admin/active if it was a downgraded user.
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, role: 'admin', status: 'active' },
    });
    console.log(`✓ promoted to admin/active: ${cfg.adminEmail}`);
    return;
  }

  const user = await prisma.user.upsert({
    where: { email: cfg.adminEmail },
    update: { passwordHash, role: 'admin', status: 'active' },
    create: {
      email: cfg.adminEmail,
      passwordHash,
      role: 'admin',
      status: 'active',
      theme: 'terminal',
      adminVariant: 'mission_control',
      lang: 'zh',
    },
  });
  console.log(`✓ ${existing ? 'updated' : 'created'} admin user: ${user.email} (id=${user.id})`);
}

// -----------------------------------------------------------------------------
// Step 4: GitHub PAT (optional)
// -----------------------------------------------------------------------------
//
// M28.bug5 — leaving the auto-register behaviour unchanged: this step
// only writes to github_tokens when INIT_GITHUB_TOKEN is in env AND the
// pool is empty. Operators who manage tokens elsewhere (admin UI, vault
// sync, external script) can simply not set INIT_GITHUB_TOKEN and this
// step no-ops.

async function ensureGithubToken(cfg: Config): Promise<void> {
  section('4 · GitHub PAT');
  const activeCount = await prisma.githubToken.count({ where: { status: 'active' } });
  if (activeCount > 0) {
    console.log(`✓ pool already has ${activeCount} active token(s) — skipping`);
    return;
  }
  if (!cfg.githubToken) {
    console.log('· skipped (no PAT provided) — add later at /admin/github-tokens');
    return;
  }
  // Validate format heuristically — classic PATs are 40 hex chars with ghp_ prefix.
  if (!/^ghp_[a-f0-9]{36}$/.test(cfg.githubToken)) {
    console.log('! PAT format unexpected (expected ghp_ + 36 hex). Saving anyway — verify in /admin/github-tokens.');
  }
  const label = await prompt('Label for this token', 'bootstrap');
  const first4 = cfg.githubToken.slice(0, 4);
  const last4 = cfg.githubToken.slice(-4);
  const tokenHash = createHash('sha256').update(cfg.githubToken).digest('hex');
  await prisma.githubToken.create({
    data: {
      label,
      tokenFirst4: first4,
      tokenLast4: last4,
      tokenHash,
      token: cfg.githubToken, // M21: stored plaintext (threat-model documented)
      status: 'active',
    },
  });
  console.log(`✓ registered: ${label} (${first4}…${last4})`);
}

// -----------------------------------------------------------------------------
// Step 5: Seed ingestion provider (optional)
// -----------------------------------------------------------------------------

async function maybeSeedProvider(cfg: Config): Promise<void> {
  section('5 · Ingestion provider');
  const existing = await prisma.ingestionProvider.count();
  if (existing > 0) {
    console.log(`✓ ${existing} provider(s) already configured — skipping`);
    return;
  }
  if (!cfg.seedProvider) {
    console.log('· skipped — create at /admin/providers when ready');
    return;
  }
  // Seed a starter JSON provider pointing at the GitHub trending archive.
  // Operators can edit / delete from /admin/providers.
  await prisma.ingestionProvider.create({
    data: {
      slug: 'gh-trending-demo',
      name: 'GitHub trending (demo)',
      sourceType: 'json',
      configJson: {
        type: 'http',
        url: 'https://api.github.com/search/repositories?q=stars:>1000&sort=stars&per_page=50',
        itemsPath: 'items',
        ownerPath: 'owner.login',
        namePath: 'name',
      },
      enabled: false, // off by default — operator reviews + enables from /admin/providers
    },
  });
  console.log('✓ seeded `gh-trending-demo` (disabled — review at /admin/providers before running)');
}

// -----------------------------------------------------------------------------
// Step 6: Seed M27 demo repository (optional)
// -----------------------------------------------------------------------------
//
// Fresh installs benefit from a sample row in the new `repo_releases` /
// `repo_branches` tables so the new normalized read path (M27.3) has
// something to return. We seed torvalds/linux as a recognizable demo
// and set `coreFetchedAt` / `releasesFetchedAt` / `branchesFetchedAt`
// so the per-facet freshness scheduler (M27.5) treats it as warm.
//
// Skipped if any repositories already exist — operators on a populated
// DB keep their real data.

async function seedM27DemoRepository(): Promise<void> {
  section('7 · M27 demo repository');

  const existing = await prisma.repository.count();
  if (existing > 0) {
    console.log(`· skipped — ${existing} repo(s) already exist`);
    return;
  }

  const now = new Date();
  // 30 / 90 / 365 days ago — gives the freshness scheduler something to
  // chew on the first time it runs.
  const coreAgo = new Date(now.getTime() - 30 * 86_400_000);
  const releasesAgo = new Date(now.getTime() - 90 * 86_400_000);
  const branchesAgo = new Date(now.getTime() - 365 * 86_400_000);

  // Core row — exercises every new column on `repositories`.
  const repo = await prisma.repository.create({
    data: {
      owner: 'torvalds',
      name: 'linux',
      description: 'Linux kernel source tree',
      private: false,
      defaultBranch: 'master',
      stars: 172_934,
      forks: 55_120,
      watchers: 9_800,
      repoCreatedAt: new Date('2011-09-11T15:30:00Z'),
      repoUpdatedAt: now,
      repoPushedAt: now,
      language: 'C',
      license: 'GPL-2.0',
      topics: ['linux', 'kernel', 'operating-system'],
      homepage: 'https://www.kernel.org/',
      archived: false,
      disabled: false,
      node: { id: 2325298, node_id: 'MDEwOlJlcG9zaXRvcnkxMzQ2Mzc1' },
      metadata: { name: 'linux', full_name: 'torvalds/linux' },
      coreFetchedAt: coreAgo,
      releasesFetchedAt: releasesAgo,
      branchesFetchedAt: branchesAgo,
      fetchStatus: 'ok',
    },
  });

  // Releases — three recent tags, exercises the top-N read path.
  await prisma.repoRelease.createMany({
    data: [
      {
        repositoryId: repo.id,
        tag: 'v6.10',
        name: 'Linux 6.10',
        publishedAt: new Date(now.getTime() - 14 * 86_400_000),
        prerelease: false,
        draft: false,
      },
      {
        repositoryId: repo.id,
        tag: 'v6.9',
        name: 'Linux 6.9',
        publishedAt: new Date(now.getTime() - 45 * 86_400_000),
        prerelease: false,
        draft: false,
      },
      {
        repositoryId: repo.id,
        tag: 'v6.8',
        name: 'Linux 6.8',
        publishedAt: new Date(now.getTime() - 75 * 86_400_000),
        prerelease: false,
        draft: false,
      },
    ],
  });

  // Branches — five protected + unprotected, exercises the LIMIT 20
  // cap on the read path.
  await prisma.repoBranch.createMany({
    data: [
      { repositoryId: repo.id, name: 'master', protected: true },
      { repositoryId: repo.id, name: 'stable', protected: true },
      { repositoryId: repo.id, name: 'linux-next', protected: true },
      { repositoryId: repo.id, name: 'akpm', protected: false },
      { repositoryId: repo.id, name: 'kbuild', protected: false },
    ],
  });

  console.log(`✓ seeded torvalds/linux (id=${repo.id}) with 3 releases + 5 branches`);
  console.log('  per-facet freshness: core=30d, releases=90d, branches=365d');
}

// -----------------------------------------------------------------------------
// Step 0.5: write SITE_NAME to .env
// -----------------------------------------------------------------------------

function writeSiteNameToEnv(siteName: string): void {
  const path = '.env';
  let content = '';
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    content = '';
  }
  const line = `SITE_NAME=${siteName}`;
  const updated = content
    .split(/\r?\n/)
    .filter((l) => !/^SITE_NAME=/.test(l))
    .concat(line)
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === '')) // dedupe trailing blanks
    .join('\n')
    .replace(/^\n+/, ''); // strip leading blanks
  writeFileSync(path, updated + '\n');
  console.log(`✓ wrote SITE_NAME to .env`);
}

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

function printSummary(): void {
  section('Done');
  console.log('Next steps:');
  console.log('  1. Visit the admin panel:');
  console.log('       http://localhost:5002/login');
  console.log(`  2. Log in with: ${process.env['INIT_ADMIN_EMAIL'] ?? '<the email you just set>'}`);
  console.log('  3. Verify GitHub tokens at: /admin/github-tokens');
  console.log('  4. If you seeded a provider, review it at: /admin/providers and enable.');
  console.log('  5. Smoke-test the public API:');
  console.log('       curl http://localhost:5002/api/v1/status');
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('githubcache bootstrap\n==========================');

  // Resolve config: env-first, then interactive prompts.
  const cfg: Config = {
    siteName: envFlag('INIT_SITE_NAME', 'GitHub Metadata Cache'),
    adminEmail: envFlag('INIT_ADMIN_EMAIL', 'admin@example.com'),
    adminPassword: envFlag(
      'INIT_ADMIN_PASSWORD',
      NON_INTERACTIVE ? 'change-me-12345678' : '',
    ),
    githubToken: process.env['INIT_GITHUB_TOKEN'] ?? null,
    seedProvider: process.env['INIT_SEED_PROVIDER'] === '1',
  };

  if (!NON_INTERACTIVE && !cfg.adminPassword) {
    cfg.adminPassword = await prompt('Admin password (≥8 chars)', '', true);
  }
  if (cfg.adminPassword.length < 8) {
    throw new Error('admin password must be at least 8 characters');
  }

  // Confirm before writing (skipped in non-interactive).
  if (!NON_INTERACTIVE) {
    console.log(`\nWill configure:`);
    console.log(`  • site name:      ${cfg.siteName}`);
    console.log(`  • admin email:    ${cfg.adminEmail}`);
    console.log(`  • admin password: ********`);
    console.log(`  • github token:   ${cfg.githubToken ? '***provided***' : 'skip'}`);
    console.log(`  • seed provider:  ${cfg.seedProvider ? 'yes' : 'no'}`);
    const proceed = await promptYesNo('Proceed?', true);
    if (!proceed) {
      console.log('Aborted.');
      return;
    }
  }

  // Persist SITE_NAME to .env so the running server picks it up on next boot.
  // ensureEnvFile() runs FIRST — it materialises .env from .env.example
  // when missing, so this siteName update appends to a real file instead
  // of creating a bare one (which would lose the DATABASE_URL placeholder).
  ensureEnvFile();
  writeSiteNameToEnv(cfg.siteName);
  await loadAppModules();
  await checkDatabase();
  runMigrations();
  await bootstrapAdmin(cfg);
  await ensureGithubToken(cfg);
  await maybeSeedProvider(cfg);
  await seedM27DemoRepository();

  printSummary();
}

main()
  .then(async () => {
    if (prisma) await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    // logger / prisma may be undefined if init failed BEFORE loadAppModules()
    // ran (e.g. .env bootstrap couldn't write, or env validation threw).
    // Fall back to console.error so we still surface the real cause.
    if (logger) {
      logger.error({ err }, 'init failed');
    }
    console.error('\n✗ init failed:', err instanceof Error ? err.message : String(err));
    if (prisma) await prisma.$disconnect();
    process.exit(1);
  });
