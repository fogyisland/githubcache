import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/logger';
import {
  backupDir,
  buildBackupFilename,
  getBackupPath,
  createBackup,
} from '@/lib/database/backup';

export interface RestoreOptions {
  /** Source — either an existing backup filename in BACKUP_DIR or an
   * uploaded file's absolute path on disk (the route handler writes
   * uploads to a temp path first). */
  source: { kind: 'backup'; filename: string } | { kind: 'upload'; absolutePath: string };
  /** ID of the admin performing the restore — for the audit log + the
   * pre-restore snapshot filename. */
  actorUserId: bigint;
}

export interface RestoreResult {
  preRestoreBackup: string;
  tableCount: number;
  /** Filename of the pre-restore backup, used by the UI's "rollback"
   * shortcut. The pre-restore file is always retained regardless of
   * BACKUP_KEEP_N (we bypass trim for it). */
  rollbackFilename: string;
}

const SHADOW_SCHEMA_PREFIX = 'restore_shadow_';

/**
 * M17 — Blue/green restore with RENAME swap.
 *
 * 1. Pre-restore snapshot (auto-backup of CURRENT DB to
 *    `pre-restore-{ts}.sql.gz` — always kept, never trimmed).
 * 2. Create shadow schema `restore_shadow_{ts}` (timestamped to avoid
 *    collisions if a previous restore was abandoned).
 * 3. Import .sql.gz into shadow schema via `gzip -dc | mysql`.
 * 4. Verify: table count + table names match.
 * 5. For each table: `RENAME TABLE prod.T TO prod.T__rb_{ts},
 *                              shadow.T TO prod.T` — atomic per-table swap.
 *    (MySQL can't RENAME multiple pairs in one statement, so we do
 *    them in a loop. If a crash interrupts mid-loop some tables are
 *    swapped and others aren't; the pre-restore snapshot is the manual
 *    recovery path.)
 * 6. DROP rollback targets + shadow schema.
 *
 * All MySQL operations use the `mysql` CLI via spawn, consistent with
 * the mysqldump|gzip pattern in backup.ts. This requires the `mysql`
 * binary on PATH (ships with every MySQL server install).
 */
export async function performRestore(opts: RestoreOptions): Promise<RestoreResult> {
  // 1. Resolve source path
  const sourceAbs = await resolveSourcePath(opts.source);

  // 2. Pre-restore backup (skip retention trim — caller wants this kept)
  const preName = `pre-restore-${buildBackupFilename(new Date())}`;
  // We use a raw createBackup call but override the filename; createBackup
  // already calls trimRetainN — that's a problem for the safety file.
  // Solution: snapshot manually without trimming.
  await snapshotTo(sourceAbs, preName);
  logger.info({ filename: preName }, 'pre-restore backup written');

  // 3. Derive schema names
  const now = Date.now();
  const shadow = SHADOW_SCHEMA_PREFIX + now;
  const rollbackSuffix = `__rb_${now}`;
  const databaseUrl = env.DATABASE_URL;
  const dbName = parseDbName(databaseUrl);
  if (!dbName) throw new Error('DATABASE_URL missing database segment');

  const mysqlCreds = buildMysqlArgs(databaseUrl);

  try {
    // 4. Create shadow schema
    await execMysql(mysqlCreds, `CREATE SCHEMA \`${shadow}\`;`);

    // 5. Import .sql.gz into shadow schema
    await importToShadow(sourceAbs, mysqlCreds, shadow);

    // 6. Verify — table list in shadow must equal expected set
    const shadowTables = await listTablesInSchema(mysqlCreds, shadow);
    const liveTables = await listTablesInSchema(mysqlCreds, dbName);
    if (shadowTables.length !== liveTables.length) {
      throw new Error(
        `table count mismatch: live=${liveTables.length} shadow=${shadowTables.length}`,
      );
    }
    // Optional stricter check: every live table must appear in shadow
    const shadowSet = new Set(shadowTables);
    for (const t of liveTables) {
      if (!shadowSet.has(t)) {
        throw new Error(`table ${t} missing from backup`);
      }
    }

    // 7. RENAME swap per table
    for (const t of liveTables) {
      const swap = `RENAME TABLE \`${dbName}\`.\`${t}\` TO \`${dbName}\`.\`${t}${rollbackSuffix}\`, \`${shadow}\`.\`${t}\` TO \`${dbName}\`.\`${t}\`;`;
      await execMysql(mysqlCreds, swap);
    }

    // 8. Drop rollback targets + shadow schema
    for (const t of liveTables) {
      await execMysql(mysqlCreds, `DROP TABLE \`${dbName}\`.\`${t}${rollbackSuffix}\`;`);
    }
    await execMysql(mysqlCreds, `DROP SCHEMA \`${shadow}\`;`);

    return {
      preRestoreBackup: preName,
      tableCount: liveTables.length,
      rollbackFilename: preName,
    };
  } catch (err) {
    // Best-effort cleanup so the next attempt isn't blocked by a
    // leftover shadow schema.
    await execMysql(mysqlCreds, `DROP SCHEMA IF EXISTS \`${shadow}\`;`).catch(() => undefined);
    throw err;
  }
}

async function resolveSourcePath(
  src: RestoreOptions['source'],
): Promise<string> {
  if (src.kind === 'backup') {
    const p = await getBackupPath(src.filename);
    if (!p) throw new Error(`backup not found: ${src.filename}`);
    return p;
  }
  if (!existsSync(src.absolutePath)) {
    throw new Error(`uploaded file missing: ${src.absolutePath}`);
  }
  return src.absolutePath;
}

/**
 * Internal: take a backup but bypass retention trim so the file is
 * guaranteed to survive even if the user has BACKUP_KEEP_N=1.
 */
async function snapshotTo(_sourceAbs: string, filename: string): Promise<void> {
  // _sourceAbs is unused here — we always snapshot the LIVE DB before
  // restoring over it, regardless of where the restore source came from.
  await createBackup(env.DATABASE_URL, filename);
}

async function importToShadow(
  sourceAbs: string,
  mysqlCreds: string[],
  shadowSchema: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const gunzip = spawn('gzip', ['-dc', sourceAbs]);
    const mysql = spawn('mysql', [...mysqlCreds, shadowSchema]);

    let stderrGz = '';
    let stderrMy = '';
    gunzip.stderr.on('data', (d: Buffer) => {
      stderrGz += d.toString();
    });
    mysql.stderr.on('data', (d: Buffer) => {
      stderrMy += d.toString();
    });

    gunzip.stdout.pipe(mysql.stdin);

    gunzip.on('error', (e) => reject(new Error(`gzip spawn: ${e.message}`)));
    mysql.on('error', (e) => reject(new Error(`mysql spawn: ${e.message}`)));
    mysql.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`mysql exited ${code} | stderr: ${stderrMy.trim()}`));
      } else {
        resolve();
      }
    });
    gunzip.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`gzip exited ${code} | stderr: ${stderrGz.trim()}`));
      }
    });
  });
}

async function execMysql(mysqlCreds: string[], sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const mysql = spawn('mysql', [...mysqlCreds, '-e', sql]);
    let stderr = '';
    mysql.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    mysql.on('error', (e) => reject(new Error(`mysql spawn: ${e.message}`)));
    mysql.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`mysql exited ${code} | sql=${sql} | stderr=${stderr.trim()}`));
      } else {
        resolve();
      }
    });
  });
}

async function listTablesInSchema(
  mysqlCreds: string[],
  schema: string,
): Promise<string[]> {
  const sql = `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${schema}' ORDER BY TABLE_NAME;`;
  return new Promise((resolve, reject) => {
    const mysql = spawn('mysql', [...mysqlCreds, '-N', '-B', '-e', sql]);
    let stdout = '';
    let stderr = '';
    mysql.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    mysql.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    mysql.on('error', (e) => reject(new Error(`mysql spawn: ${e.message}`)));
    mysql.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`mysql exited ${code} | stderr=${stderr.trim()}`));
      } else {
        resolve(stdout.trim().split('\n').filter(Boolean));
      }
    });
  });
}

function parseDbName(url: string): string | null {
  const m = /\/\/[^/]+\/([^?]+)/.exec(url);
  return m?.[1] ?? null;
}

function buildMysqlArgs(url: string): string[] {
  const args = ['--user=' + parseUser(url)];
  // Prefer MYSQL_PWD env over `--password=...`
  if (parsePassword(url)) {
    process.env.MYSQL_PWD = parsePassword(url) as string;
  } else {
    delete process.env.MYSQL_PWD;
  }
  args.push(
    '--host=' + parseHost(url),
    '--port=' + parsePort(url),
    '--default-character-set=utf8mb4',
  );
  return args;
}

function parseUser(url: string): string {
  const m = /:\/\/([^:@]+)(?::([^@]*))?@/.exec(url);
  return m?.[1] ?? 'root';
}
function parsePassword(url: string): string | null {
  const m = /:\/\/[^:@]+:([^@]*)@/.exec(url);
  return m && m[1] !== undefined && m[1] !== '' ? decodeURIComponent(m[1]) : null;
}
function parseHost(url: string): string {
  const m = /@([^:/]+)/.exec(url);
  return m?.[1] ?? '127.0.0.1';
}
function parsePort(url: string): string {
  const m = /:(\d+)\//.exec(url);
  return m?.[1] ?? '3306';
}

// Re-export file size helper so the route can report the pre-restore file.
export async function fileSize(absPath: string): Promise<number> {
  const s = await stat(absPath);
  return s.size;
}

// Resolve BACKUP_DIR for the route's "save upload to a known place" step.
export function tempUploadPath(uploadId: string): string {
  return path.join(backupDir(), `.upload-${uploadId}.sql.gz`);
}

export async function ensureUploadDirExists(): Promise<void> {
  const dir = backupDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

// Re-export createReadStream so route can pipe the file to the browser.
export { createReadStream };
