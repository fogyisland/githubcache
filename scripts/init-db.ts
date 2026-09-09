/**
 * First-time DB init: create all tables from schema, mark migrations applied.
 *
 * M28.bug24 — PinYinCharacter pattern. The wizard's step 3 used to call
 * `prisma migrate deploy` to apply all 22 migration files in sequence.
 * Two problems with that:
 *   1. P3009 if any previous migration is recorded as failed (e.g. the
 *      dropped SUPER-requiring trigger migration).
 *   2. P3018/1419 when a fresh DB tries the trigger migration, which
 *      standard managed MySQL blocks.
 *
 * Replacement: use `prisma db push --accept-data-loss --force-reset` to
 * sync the DB to schema (idempotent on a fresh DB). Then bulk-insert all
 * migration rows into `_prisma_migrations` so a subsequent
 * `prisma migrate deploy` (during upgrades) sees everything as applied
 * and is a no-op.
 *
 * Upgrades after init use `prisma migrate deploy` normally — only new
 * migrations get applied.
 *
 * Idempotent: detects if `users` table exists and skips table creation
 * (writes migration marks regardless — safe no-op).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '@/lib/db/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'prisma', 'migrations');

interface MigrationRow {
  migration_name: string;
  checksum: string;
  finished_at: Date;
  applied_steps_count: number;
}

function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/**
 * Compute Prisma's checksum: SHA256 of the migration file content.
 * Prisma uses this exact algorithm when applying migrations.
 */
function checksumOf(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function tablesExist(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM users LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}

async function ensureSchema(): Promise<void> {
  if (await tablesExist()) {
    console.log('[init-db] tables already exist — skipping db push');
    return;
  }
  console.log('[init-db] fresh database — running prisma db push...');
  const r = spawnSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
  if (r.status !== 0) {
    throw new Error(`prisma db push failed (exit ${r.status})`);
  }
}

/**
 * Recreate _prisma_migrations after `prisma db push` (which drops it
 * because it's not in schema.prisma). Schema mirrors Prisma 5.x's
 * internal table.
 */
async function ensureMigrationsTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS _prisma_migrations (
      id VARCHAR(36) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      migration_name VARCHAR(255) NOT NULL,
      finished_at DATETIME(3) NULL,
      applied_steps_count INT NOT NULL DEFAULT 0,
      logs TEXT NULL,
      started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      rolled_back_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      UNIQUE INDEX _prisma_migrations_migration_name_key (migration_name)
    )
  `);
}

async function markMigrationsApplied(): Promise<void> {
  const migrations = listMigrations();
  console.log(`[init-db] marking ${migrations.length} migrations applied...`);

  // Prisma uses this exact DDL shape for _prisma_migrations; copied
  // verbatim from the prisma migrate deploy internals so the rows match
  // what a real apply would have inserted.
  for (const name of migrations) {
    const sqlPath = join(MIGRATIONS_DIR, name, 'migration.sql');
    const checksum = checksumOf(sqlPath);
    const finishedAt = new Date();
    // Use INSERT IGNORE so re-running is safe; the unique index on
    // migration_name dedupes.
    await prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO _prisma_migrations
        (id, checksum, migration_name, finished_at, applied_steps_count, logs)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      randomBytes(12).toString('hex'),
      checksum,
      name,
      finishedAt,
      1,
    );
  }
  console.log('[init-db] all migrations marked');
}

async function main(): Promise<void> {
  await ensureSchema();
  await ensureMigrationsTable();
  await markMigrationsApplied();
  console.log('[init-db] done');
}

main()
  .catch((e: unknown) => {
    console.error('[init-db] failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });