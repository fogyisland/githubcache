import { spawn } from 'node:child_process';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, stat, unlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/logger';

export interface BackupFileInfo {
  filename: string;
  size: number;
  mtime: Date;
}

export interface CreateBackupResult {
  filename: string;
  absolutePath: string;
  size: number;
}

/**
 * M17 — Build the canonical backup filename.
 *
 * Format: `githubcache-YYYYMMDD-HHMMSS.sql.gz`
 *
 * The local-time timestamp makes files sort lexicographically in the
 * list view. `pre-restore-*` is reserved for the auto-snapshot taken
 * immediately before a restore (see restore.ts).
 */
export function buildBackupFilename(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `githubcache-${ts}.sql.gz`;
}

/**
 * Resolve the absolute backup directory. Relative BACKUP_DIR is resolved
 * against process.cwd() at the moment of the call (not at boot) so the
 * tests can override cwd.
 */
export function backupDir(): string {
  return path.isAbsolute(env.BACKUP_DIR)
    ? env.BACKUP_DIR
    : path.resolve(process.cwd(), env.BACKUP_DIR);
}

async function ensureBackupDir(): Promise<string> {
  const dir = backupDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

/**
 * Spawn `mysqldump --single-transaction --routines --triggers <db>` piped
 * through `gzip -6` into `dir/`. Resolves on `close` exit code
 * 0 from gzip; rejects on any non-zero exit or stream error.
 *
 * `--single-transaction` makes mysqldump take a consistent snapshot of
 * InnoDB tables without locking. The two extra flags preserve stored
 * procedures and triggers which `--skip-comments`-style minimal dumps
 * would drop.
 */
export async function createBackup(
  databaseUrl: string,
  filename?: string,
): Promise<CreateBackupResult> {
  const dir = await ensureBackupDir();
  const name = filename ?? buildBackupFilename();
  const absolutePath = path.join(dir, name);

  const dbName = parseDatabaseName(databaseUrl);
  if (!dbName) {
    throw new Error('DATABASE_URL missing a database segment');
  }

  // mysqldump args — host/user/password come from a `[client]` group in
  // a temporary my.cnf we never write to disk. Simpler approach for the
  // operator-hostile-but-good-enough case: pass user/password on the
  // command line. Both mysqldump and mysql read them via `--user=...`
  // and `--password=...`. MySQL CLI flags `--password` without a value
  // to read from MYSQL_PWD env (preferred — ps can't see it).
  const args = ['--user=' + parseUser(databaseUrl)];
  if (parsePassword(databaseUrl)) {
    args.push('--password=' + parsePassword(databaseUrl));
  }
  args.push(
    '--host=' + parseHost(databaseUrl),
    '--port=' + parsePort(databaseUrl),
    '--single-transaction',
    '--routines',
    '--triggers',
    '--default-character-set=utf8mb4',
    dbName,
  );

  const envWithPwd: NodeJS.ProcessEnv = { ...process.env };
  // Prefer MYSQL_PWD env (invisible to ps) over `--password=...` flag.
  const pwd = parsePassword(databaseUrl);
  if (pwd) {
    envWithPwd.MYSQL_PWD = pwd;
    // Strip --password flag if we set it; mysqldump will read MYSQL_PWD.
    const pwdIdx = args.findIndex((a) => a.startsWith('--password='));
    if (pwdIdx !== -1) args.splice(pwdIdx, 1);
  }

  await new Promise<void>((resolve, reject) => {
    const mysqldump = spawn('mysqldump', args, { env: envWithPwd });
    const gzip = spawn('gzip', ['-6']);
    const out = createWriteStream(absolutePath);

    let stderrDump = '';
    let stderrGzip = '';

    mysqldump.stderr.on('data', (d: Buffer) => {
      stderrDump += d.toString();
    });
    gzip.stderr.on('data', (d: Buffer) => {
      stderrGzip += d.toString();
    });

    mysqldump.stdout.pipe(gzip.stdin);
    gzip.stdout.pipe(out);

    const fail = (msg: string): void => {
      // Best-effort cleanup of partial file
      void unlink(absolutePath).catch(() => undefined);
      reject(new Error(`${msg} | mysqldump: ${stderrDump.trim()} | gzip: ${stderrGzip.trim()}`));
    };

    mysqldump.on('error', (e) => fail(`mysqldump spawn failed: ${e.message}`));
    gzip.on('error', (e) => fail(`gzip spawn failed: ${e.message}`));

    out.on('error', (e) => fail(`write failed: ${e.message}`));

    gzip.on('close', (code) => {
      if (code !== 0) return fail(`gzip exited ${code}`);
    });
    mysqldump.on('close', (code) => {
      if (code !== 0) return fail(`mysqldump exited ${code}`);
    });
    out.on('finish', () => {
      resolve();
    });
  });

  const stats = await stat(absolutePath);
  logger.info({ filename: name, size: stats.size }, 'backup written');

  await trimRetainN();

  return { filename: name, absolutePath, size: stats.size };
}

/**
 * List all .sql.gz files in BACKUP_DIR sorted newest-first.
 * Excludes the `pre-restore-*` snapshots from the UI list? No — keep
 * them visible. Operators need to see them as safety net.
 */
export async function listBackups(): Promise<BackupFileInfo[]> {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files: BackupFileInfo[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith('.sql.gz')) continue;
    const p = path.join(dir, e.name);
    const s = await stat(p);
    files.push({ filename: e.name, size: s.size, mtime: s.mtime });
  }
  files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return files;
}

export async function getBackupPath(filename: string): Promise<string | null> {
  // Defence-in-depth: reject anything outside the BACKUP_DIR tree and
  // anything that doesn't match the canonical pattern.
  if (!filename.endsWith('.sql.gz')) return null;
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return null;
  }
  const p = path.join(backupDir(), filename);
  if (!existsSync(p)) return null;
  return p;
}

/**
 * Delete every .sql.gz beyond the most-recent N. Operates on the entire
 * BACKUP_DIR; pre-restore snapshots are included in the count (they
 * count toward the cap).
 */
export async function trimRetainN(): Promise<string[]> {
  const keep = env.BACKUP_KEEP_N;
  if (keep === 0) return [];
  const all = await listBackups();
  const toDelete = all.slice(keep);
  const deleted: string[] = [];
  for (const f of toDelete) {
    await unlink(path.join(backupDir(), f.filename));
    deleted.push(f.filename);
    logger.info({ filename: f.filename }, 'backup trimmed (retention)');
  }
  return deleted;
}

// ---- DATABASE_URL parsing helpers ----
// Format: mysql://user:password@host:port/database?params
// We accept any params and ignore them; mysqldump/mysql CLI handle
// params via env vars if needed.

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
function parseDatabaseName(url: string): string | null {
  const m = /\/\/[^/]+\/([^?]+)/.exec(url);
  return m?.[1] ?? null;
}

// Re-export to keep callers from importing `node:fs` directly.
export { createReadStream };
