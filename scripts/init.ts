/**
 * Bootstrap script — runs the full first-time setup in one command.
 *
 *   npm run init                       # interactive
 *   npm run init -- --non-interactive   # CI/automation: admin@example.com / auto PAT from env
 *   npm run init -- --reset-admin      # also reset the existing admin's password
 *
 * What it does (idempotent — safe to run multiple times):
 *   1. Verifies DATABASE_URL is set and the MySQL connection works
 *   2. Confirms prisma migrations are up to date (no pending)
 *   3. Creates / promotes the bootstrap admin user
 *   4. Optionally registers a GitHub PAT (skipped if pool already has 1+ active)
 *   5. Optionally seeds a starter ingestion provider (skipped if any exist)
 *   6. Prints a summary: URL, login creds, next steps
 *
 * This complements `scripts/create-admin.ts` (which only handles step 3) and
 * `scripts/mint-local-api-key.ts` (API key only). Use this when you need the
 * whole server up — fresh VM, new clone, post-disaster rebuild.
 */
import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { logger } from '@/lib/logger';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

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
// Step 2: Migration status (informational; we don't auto-migrate here)
// -----------------------------------------------------------------------------

async function checkMigrations(): Promise<void> {
  section('2 · Migration status');
  try {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5
    `;
    const pending = rows.filter((r) => r.finished_at === null);
    if (pending.length > 0) {
      console.log(`! ${pending.length} pending migration(s) found:`);
      for (const p of pending) console.log(`    - ${p.migration_name}`);
      console.log('  Run: npx prisma migrate deploy');
      throw new Error('pending migrations — refusing to continue');
    }
    const last = rows[0]?.migration_name ?? '(none)';
    console.log(`✓ up to date — last applied: ${last}`);
  } catch (e) {
    if (e instanceof Error && e.message.includes('pending migrations')) throw e;
    // Table might not exist yet (fresh DB); fall through to migration deploy hint.
    console.log('! _prisma_migrations not found — DB may be empty');
    console.log('  Run: npx prisma migrate deploy');
    throw e;
  }
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
  section('6 · M27 demo repository');

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
  // (No-op if already up to date — we only rewrite the line if it differs.)
  writeSiteNameToEnv(cfg.siteName);

  await checkDatabase();
  await checkMigrations();
  await bootstrapAdmin(cfg);
  await ensureGithubToken(cfg);
  await maybeSeedProvider(cfg);
  await seedM27DemoRepository();

  printSummary();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    logger.error({ err }, 'init failed');
    console.error('\n✗ init failed:', err instanceof Error ? err.message : String(err));
    await prisma.$disconnect();
    process.exit(1);
  });
