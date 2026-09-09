/**
 * M28.bug25 — list applied + pending migrations from _prisma_migrations.
 *
 * Read-only view into the deploy state. Compares against migration
 * files in prisma/migrations/ to surface pending migrations in the
 * admin UI's schema-upgrade panel.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'prisma', 'migrations');

export interface MigrationInfo {
  /** Directory name (e.g. "20260815114506_m1_repositories") */
  name: string;
  /** YYYYMMDDHHMMSS prefix */
  timestamp: string;
  /** Slug after the timestamp (e.g. "m1_repositories") */
  slug: string;
  /** SHA256 of migration.sql — must match _prisma_migrations.checksum */
  checksum: string;
  /** True when the row is present in _prisma_migrations (not rolled back) */
  applied: boolean;
  /** finished_at from the DB, if applied */
  finishedAt: Date | null;
}

interface MigrationRow {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

function listMigrationFiles(): MigrationInfo[] {
  let entries: string[];
  try {
    entries = readdirSync(MIGRATIONS_DIR).filter((n) => {
      const full = join(MIGRATIONS_DIR, n);
      return statSync(full).isDirectory() && n !== 'migration_lock.toml';
    });
  } catch {
    return [];
  }
  return entries
    .sort()
    .map((name) => {
      const ts = name.split('_')[0] ?? '';
      const sql = readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'));
      const checksum = createHash('sha256').update(sql).digest('hex');
      return { name, timestamp: ts, slug: name.slice(ts.length + 1), checksum, applied: false, finishedAt: null };
    });
}

export async function getMigrationStatus(): Promise<MigrationInfo[]> {
  const files = listMigrationFiles();
  // Read the rows; if _prisma_migrations doesn't exist (shouldn't happen
  // after init-db but defensively) treat every file as pending.
  const rows: MigrationRow[] = (await prisma.$queryRawUnsafe(`
    SELECT migration_name, checksum, finished_at, rolled_back_at
      FROM _prisma_migrations
  `).catch(() => [])) as MigrationRow[];
  const byName = new Map(rows.map((r) => [r.migration_name, r]));
  return files.map((f) => {
    const row = byName.get(f.name);
    return {
      ...f,
      applied: row !== undefined && row.rolled_back_at === null,
      finishedAt: row?.finished_at ?? null,
    };
  });
}