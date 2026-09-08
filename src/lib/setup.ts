/**
 * First-time setup helpers (M28.bug12 — web UI init wizard, replaces CLI init).
 *
 * Pattern mirrors E:\ToolDevelop\PinYinCharacter\lib\setup.ts:
 *   1. /init wizard collects DB credentials, tests connection, writes .env
 *   2. /init admin step collects admin email/password, server creates user
 *   3. /init execute runs prisma migrate deploy + bootstrap
 *   4. isSetupComplete() returns true → middleware stops redirecting to /init
 *
 * Key design choices:
 *   - Pool is closed after each .env write so the next request re-creates
 *     it from the new DATABASE_URL (mirrors PinYinCharacter's closePool)
 *   - .env values are written via upsertEnvLine to preserve other keys
 *   - DB probe uses mysql2/promise directly (NOT Prisma) so a wrong creds
 *     doesn't crash the shared prisma client instance
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';

const ENV_PATH = join(process.cwd(), '.env');
export { ENV_PATH };

/** Generate a cryptographically random secret (≥32 chars). */
export function generateSecret(): string {
  return randomBytes(24).toString('hex');
}

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface DbTestResult {
  ok: boolean;
  error?: string;
  // echoes back the candidate DATABASE_URL the server would write, so the UI
  // can show "we'd persist this" for verification before commit
  wouldWrite: string;
  // MySQL server version string parsed from the handshake greeting — used
  // for the success log so the operator sees "MySQL 5.7.44" instead of just
  // "connected"
  version?: string;
}

/** Test a candidate DB config without polluting Prisma's shared client.
 *
 * M28.bug12: we use raw TCP via node:net (no extra deps). MySQL server's
 * initial handshake packet starts with a single protocol-version byte
 * (0x0a for MySQL 5/8) followed by the server version string — we read
 * a few bytes to confirm the listener is a MySQL daemon and not some
 * random service answering on 3306. Auth check is deferred to the
 * migrate step where prisma actually authenticates.
 *
 * Trade-off: a wrong password passes this probe but fails migrate. The
 * user gets the same clear MySQL "Access denied" message either way —
 * just surfaced from a different step. We accept that because
 * installing mysql2/promise for the probe alone would be a 700 KB dep
 * we don't need anywhere else.
 */
export async function testDbConnection(cfg: DbConfig): Promise<DbTestResult> {
  const url = buildDatabaseUrl(cfg);
  return new Promise((resolve) => {
    const sock = createConnection({ host: cfg.host, port: cfg.port });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve({ ok: false, error: `连接超时（10s）：${cfg.host}:${cfg.port}`, wouldWrite: url });
    }, 10_000);

    sock.once('data', (chunk) => {
      // MySQL handshake packet format:
      //   byte 0..2 = payload length (little endian 3-byte int)
      //   byte 3    = sequence id (always 0 for server greeting)
      //   byte 4    = protocol version (0x0a for MySQL 5/8)
      //   byte 5..  = null-terminated version string ("5.7.44", "8.0.32", ...)
      //
      // We need at least 5 bytes to confirm a MySQL greeting; anything shorter
      // or with a non-0x0a protocol byte is some other service answering.
      clearTimeout(timer);
      sock.destroy();
      if (chunk.length < 5) {
        resolve({
          ok: false,
          error: `端口 ${cfg.port} 响应太短（${chunk.length} 字节），不是 MySQL 握手`,
          wouldWrite: url,
        });
      } else if (chunk[4] !== 0x0a) {
        resolve({
          ok: false,
          error: `端口 ${cfg.port} 响应不是 MySQL 协议（协议字节 0x${chunk[4]?.toString(16)}，期望 0x0a）`,
          wouldWrite: url,
        });
      } else {
        // Read the null-terminated version string for the success log.
        const end = chunk.indexOf(0, 5);
        const version = end > 5 ? chunk.slice(5, end).toString('ascii') : 'unknown';
        resolve({ ok: true, wouldWrite: url, version });
      }
    });
    sock.once('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message, wouldWrite: url });
    });
  });
}

/** mysql://user:pass@host:port/database (no query params). */
export function buildDatabaseUrl(cfg: DbConfig): string {
  const safeUser = encodeURIComponent(cfg.user);
  const safePass = encodeURIComponent(cfg.password);
  return `mysql://${safeUser}:${safePass}@${cfg.host}:${cfg.port}/${cfg.database}`;
}

/**
 * Idempotent line-replace in .env. Inserts before the first blank-line block
 * (preserves .env.example's grouping: vars on top, comments below).
 */
export function upsertEnvLine(content: string, key: string, value: string): string {
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((l) => new RegExp(`^${key}=`).test(l));
  const newLine = `${key}=${value}`;
  if (idx >= 0) {
    lines[idx] = newLine;
  } else {
    const insertAt = lines.findIndex(
      (l) => l.trim() === '' || l.trim().startsWith('#'),
    );
    if (insertAt >= 0) {
      lines.splice(insertAt, 0, newLine);
    } else {
      lines.push(newLine);
    }
  }
  return lines
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n')
    .replace(/^\n+/, '')
    .concat('\n');
}

/**
 * Write DATABASE_URL + SESSION_SECRET to .env. Creates .env from .env.example
 * if missing. Preserves existing values for other keys. Returns whether a
 * new SESSION_SECRET was generated (so the UI can show "your fresh secret is X").
 */
export interface WriteResult {
  created: boolean;
  freshSecret: string | null;
}

export function writeSetupEnv(databaseUrl: string): WriteResult {
  if (!existsSync(ENV_PATH) && existsSync('.env.example')) {
    // Lazy import via dynamic require so tests don't trip on missing .env.example
    const { copyFileSync } = require('node:fs') as typeof import('node:fs');
    copyFileSync('.env.example', ENV_PATH);
  }
  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  content = upsertEnvLine(content, 'DATABASE_URL', databaseUrl);

  // Regenerate SESSION_SECRET if it's the placeholder or missing.
  const PLACEHOLDER = new Set([
    'replace-with-32-chars-min-secret',
    'dev-secret-change-me-32-chars-min-aaaaa',
  ]);
  const m = /^SESSION_SECRET=(.*)$/m.exec(content);
  const current = m ? m[1] : '';
  let freshSecret: string | null = null;
  if (!current || PLACEHOLDER.has(current)) {
    freshSecret = generateSecret();
    content = upsertEnvLine(content, 'SESSION_SECRET', freshSecret);
  }
  writeFileSync(ENV_PATH, content);

  // Reload process.env so subsequent steps in this request see new values.
  //
  // M28.bug12 follow-up: writeSetupEnv runs BEFORE Prisma instantiates
  // its client in the next request. Prisma reads process.env.DATABASE_URL
  // at module-load time and snapshots it. If a stale stub URL leaked in
  // earlier (e.g. from a leftover .env.production, a shell export, or the
  // dev server's --env-file=.env on a previous boot), it WINS over the
  // .env value because the original write loop only fills undefined keys.
  //
  // Fix: always overwrite DATABASE_URL (the wizard is the source of truth
  // for it), keep the missing-key fill behavior for other vars so we don't
  // clobber unrelated shell config like LOG_LEVEL.
  process.env['DATABASE_URL'] = databaseUrl;
  for (const line of content.split(/\r?\n/)) {
    const mm = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!mm || !mm[1] || mm[2] === undefined) continue;
    if (mm[1] === 'DATABASE_URL') continue; // already set
    if (process.env[mm[1]] === undefined) {
      process.env[mm[1]] = mm[2];
    }
  }
  return { created: !existsSync(ENV_PATH), freshSecret };
}

/**
 * Is setup complete?
 *
 * M28.bug12: a deployment is "setup complete" iff:
 *   1. .env exists on disk AND
 *   2. .env contains a non-empty DATABASE_URL
 *
 * This is intentionally cheap (no DB probe) so middleware can call it on
 * every request without performance cost. After the wizard runs migrate
 * + creates the admin, /api/init/mark-complete flips setup_completed, but
 * for the redirect gate we don't need that — DATABASE_URL being present
 * is sufficient.
 */
export function isSetupComplete(): boolean {
  if (!existsSync(ENV_PATH)) return false;
  const content = readFileSync(ENV_PATH, 'utf8');
  const m = /^DATABASE_URL=(.+)$/m.exec(content);
  if (!m || !m[1]) return false;
  const url = m[1].trim();
  // Reject the .env.example placeholder that init used to leak through
  if (/^mysql:\/\/(user|root|admin|stub):[^@]+@(localhost|127\.0\.0\.1|db):\d+\//.test(url)) {
    return false;
  }
  return url.length > 0;
}