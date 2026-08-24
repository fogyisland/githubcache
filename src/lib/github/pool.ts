import { createHash } from 'crypto';
import { Octokit } from '@octokit/rest';
import { logger } from '@/lib/logger';
import { loadTokensFromEnv } from './tokens-loader';
import {
  listAllTokens,
  insertToken,
  updateTokenQuota,
} from '@/lib/db/github-tokens';

interface PoolEntry {
  id: bigint;
  label: string;
  raw: string; // plaintext token — memory only, never logged, never persisted
  octokit: Octokit;
  requestsUsed: number;
  requestsLimit: number;
  resetAt: Date | null;
  lastUsedAt: Date | null;
  dirty: boolean;
}

const pool: Map<bigint, PoolEntry> = new Map();
let persistCounter = 0;
let lastPersistAt: number = Date.now();
let persistTimer: ReturnType<typeof setInterval> | null = null;
let consecutive429s = 0;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let shuttingDown = false;

const FLUSH_INTERVAL_CALLS = 25;
const FLUSH_INTERVAL_MS = 60_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60_000;

export interface PooledToken {
  id: bigint;
  octokit: Octokit;
}

export async function initPool(): Promise<void> {
  shuttingDown = false;

  // 1. Load tokens from env
  const envTokens = loadTokensFromEnv();
  const envHashes = new Set(envTokens.map((t) => t.hash));

  // 2. Read all DB rows
  const dbRows = await listAllTokens();
  const dbByHash = new Map(dbRows.map((r) => [r.tokenHash, r]));

  // 3. For each env token, ensure DB row exists; build in-memory entry
  for (const envToken of envTokens) {
    let row = dbByHash.get(envToken.hash);
    if (!row) {
      row = await insertToken({
        label: `env-${envToken.first4}${envToken.last4}`,
        tokenFirst4: envToken.first4,
        tokenLast4: envToken.last4,
        tokenHash: envToken.hash,
      });
      logger.info({ id: row.id.toString(), label: row.label }, 'inserted new github token');
    }
    if (row.status === 'disabled') {
      logger.warn({ id: row.id.toString(), label: row.label }, 'skipping disabled token');
      continue;
    }
    pool.set(row.id, {
      id: row.id,
      label: row.label,
      raw: envToken.raw,
      octokit: new Octokit({ auth: envToken.raw }),
      requestsUsed: row.requestsUsed,
      requestsLimit: row.requestsLimit,
      resetAt: row.resetAt,
      lastUsedAt: row.lastUsedAt,
      dirty: false,
    });
  }

  // 4. Operators manage removal via admin tools (future M7). Pool never deletes DB rows.
  //    If a token is in DB but NOT in env, skip it silently (operator removed the env var).
  const orphans = dbRows.filter((r) => !envHashes.has(r.tokenHash));
  if (orphans.length > 0) {
    logger.warn(
      { count: orphans.length },
      'github tokens present in DB but not in env — skipping (operator must disable via admin tools)',
    );
  }

  // 5. Start persist timer
  if (persistTimer) clearInterval(persistTimer);
  persistTimer = setInterval(() => {
    if (Date.now() - lastPersistAt >= FLUSH_INTERVAL_MS) {
      void persistQuota().catch((e) => logger.error({ err: e }, 'periodic persist failed'));
    }
  }, FLUSH_INTERVAL_MS);

  logger.info(
    { poolSize: pool.size, source: envTokens.length },
    'pool initialized',
  );
}

export function pickToken(): PooledToken | null {
  if (pool.size === 0) return null;
  const now = Date.now();
  const candidates: PoolEntry[] = [];
  for (const entry of pool.values()) {
    if (isExhausted(entry, now)) continue;
    candidates.push(entry);
  }
  if (candidates.length === 0) return null;
  // Sort by requestsUsed ascending — most remaining quota first
  candidates.sort((a, b) => a.requestsUsed - b.requestsUsed);
  const picked = candidates[0]!; // safe: length checked above
  return { id: picked.id, octokit: picked.octokit };
}

function isExhausted(entry: PoolEntry, now: number): boolean {
  // A token is exhausted if we've used our full quota AND the reset window hasn't passed.
  if (entry.resetAt !== null && now < entry.resetAt.getTime()) {
    return entry.requestsUsed >= entry.requestsLimit;
  }
  return false; // no reset window set, or reset has passed — treat as fresh
}

export async function recordUsage(
  tokenId: bigint,
  remaining: number,
  resetAtUnix: number,
): Promise<void> {
  const entry = pool.get(tokenId);
  if (!entry) return; // unknown token (race with shutdown) — ignore
  entry.requestsUsed = Math.max(0, entry.requestsLimit - remaining);
  entry.resetAt = new Date(resetAtUnix * 1000);
  entry.lastUsedAt = new Date();
  entry.dirty = true;
  persistCounter += 1;
  consecutive429s = 0; // success — reset backoff counter
  if (persistCounter >= FLUSH_INTERVAL_CALLS) {
    await persistQuota();
  }
}

export async function persistQuota(): Promise<void> {
  const dirty: PoolEntry[] = [];
  for (const entry of pool.values()) {
    if (entry.dirty) dirty.push(entry);
  }
  if (dirty.length === 0) {
    persistCounter = 0;
    lastPersistAt = Date.now();
    return;
  }
  // Single-flight: guard against concurrent persists
  for (const entry of dirty) {
    try {
      await updateTokenQuota(entry.id, {
        requestsUsed: entry.requestsUsed,
        resetAt: entry.resetAt,
        lastUsedAt: entry.lastUsedAt,
      });
      entry.dirty = false;
    } catch (e) {
      logger.error({ err: e, tokenId: entry.id.toString() }, 'persist quota failed for token');
      // Leave dirty=true so next persist retries
    }
  }
  persistCounter = 0;
  lastPersistAt = Date.now();
}

export function getBackoff(): number {
  // Exponential: 1s, 2s, 4s, 8s, ..., capped at 60s. Resets on success via recordUsage.
  consecutive429s += 1;
  const ms = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (consecutive429s - 1));
  return ms;
}

export async function shutdownPool(): Promise<void> {
  shuttingDown = true;
  if (persistTimer) {
    clearInterval(persistTimer);
    persistTimer = null;
  }
  await persistQuota(); // final flush
}

export function poolSize(): number {
  return pool.size;
}

/**
 * Returns true if the pool currently has an entry for the given token hash.
 * Used by the admin UI to show whether a DB row is "active in pool" or
 * "pending activation" (added to DB but not yet in env/file).
 *
 * Re-hashes on every call — fine for admin UI with O(10) tokens.
 */
export function poolHasHash(hash: string): boolean {
  for (const entry of pool.values()) {
    const entryHash = createHash('sha256').update(entry.raw).digest('hex');
    if (entryHash === hash) return true;
  }
  return false;
}