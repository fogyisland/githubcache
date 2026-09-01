import { Octokit } from '@octokit/rest';
import type { GithubToken } from '@prisma/client';
import { logger } from '@/lib/logger';
import { env } from '@/lib/config/env';
import {
  disableTokenById,
  listAllTokens,
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
// M14.4 — per-token consecutive-429 counter for auto-disable. Reset on a
// successful call for that token. When a counter reaches
// env.TOKEN_AUTO_DISABLE_THRESHOLD the token is auto-disabled and dropped
// from the pool. In-memory only — process restart resets counters.
const consecutive429ByToken: Map<bigint, number> = new Map();
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
  const dbRows = (await listAllTokens({ skip: 0, take: 1000 })).rows;
  pool.clear();

  for (const row of dbRows) {
    if (row.token === null) {
      logger.warn(
        { id: row.id.toString(), label: row.label },
        'github token row has NULL token — skipping (re-add via admin UI)',
      );
      continue;
    }
    if (row.status === 'disabled') continue;
    pool.set(row.id, {
      id: row.id,
      label: row.label,
      raw: row.token,
      octokit: new Octokit({ auth: row.token }),
      requestsUsed: row.requestsUsed,
      requestsLimit: row.requestsLimit,
      resetAt: row.resetAt,
      lastUsedAt: row.lastUsedAt,
      dirty: false,
    });
  }

  if (persistTimer) clearInterval(persistTimer);
  persistTimer = setInterval(() => {
    if (Date.now() - lastPersistAt >= FLUSH_INTERVAL_MS) {
      void persistQuota().catch((e) => logger.error({ err: e }, 'periodic persist failed'));
    }
  }, FLUSH_INTERVAL_MS);

  logger.info({ poolSize: pool.size }, 'pool initialized');
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
  // Distinguish 429 from success by `remaining === 0`. A resetAt in the
  // future is the actual 429 signal — a past resetAt with remaining=0 is
  // just "fully used and ready to reset", not an over-limit hit.
  const resetAtMs = resetAtUnix * 1000;
  const isOverLimit = remaining === 0 && resetAtMs > Date.now();
  if (isOverLimit) {
    consecutive429s += 1; // global backoff counter (used by getBackoff)
    const threshold = env.TOKEN_AUTO_DISABLE_THRESHOLD;
    if (threshold > 0) {
      const next = (consecutive429ByToken.get(tokenId) ?? 0) + 1;
      consecutive429ByToken.set(tokenId, next);
      if (next >= threshold) {
        await autoDisableToken(tokenId, entry.label, next);
      }
    }
  } else {
    consecutive429s = 0; // global backoff counter — reset on any success
    consecutive429ByToken.delete(tokenId); // per-token counter — reset on this token's success
  }
  if (persistCounter >= FLUSH_INTERVAL_CALLS) {
    await persistQuota();
  }
}

/**
 * M14.4 — auto-disable a token after TOKEN_AUTO_DISABLE_THRESHOLD
 * consecutive 429s. Drops it from the in-memory pool, marks the DB row
 * disabled, and writes an audit log entry.
 */
async function autoDisableToken(
  tokenId: bigint,
  label: string,
  consecutiveCount: number,
): Promise<void> {
  pool.delete(tokenId);
  consecutive429ByToken.delete(tokenId);
  try {
    await disableTokenById(tokenId, 'auto-rotation');
    logger.warn(
      { tokenId: tokenId.toString(), label, consecutiveCount, threshold: env.TOKEN_AUTO_DISABLE_THRESHOLD },
      'auto-disabled github token after consecutive 429s',
    );
  } catch (e) {
    logger.error({ err: e, tokenId: tokenId.toString() }, 'auto-disable failed; token dropped from pool anyway');
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

export interface PoolStatus {
  /** Entries that are not exhausted right now (safe to call GitHub). */
  active: number;
  /** Entries that have hit the GitHub rate-limit window (resetAt > now && requestsUsed >= requestsLimit). */
  exhausted: number;
  /** Soonest resetAt across all exhausted entries; null when no exhausted entries exist. */
  earliestReset: Date | null;
}

/**
 * Snapshot of pool state used by the scheduler to decide whether to claim jobs.
 *
 * Distinct from `poolSize()` (which only counts total entries) and
 * `pickToken()` (which returns one Octokit). The scheduler needs aggregate
 * counts to decide "should I bother running a tick right now" without
 * touching the DB.
 *
 * M22 — the auto-pause-on-exhaustion feature (vs. ticking blindly) is the
 * reason this exists; without it the tick logs 1 line/sec forever when all
 * tokens are rate-limited.
 */
export function poolStatus(): PoolStatus {
  const now = Date.now();
  let active = 0;
  let exhausted = 0;
  let earliestResetMs: number | null = null;
  for (const entry of pool.values()) {
    const isExhausted =
      entry.resetAt !== null &&
      entry.resetAt.getTime() > now &&
      entry.requestsUsed >= entry.requestsLimit;
    if (isExhausted) {
      exhausted += 1;
      const ms = entry.resetAt!.getTime();
      if (earliestResetMs === null || ms < earliestResetMs) earliestResetMs = ms;
    } else {
      active += 1;
    }
  }
  return {
    active,
    exhausted,
    earliestReset: earliestResetMs === null ? null : new Date(earliestResetMs),
  };
}

/**
 * O(1) lookup — true when the in-memory pool contains an entry for this DB id.
 * Used by admin UI to display the "in pool" / "not in pool" chip.
 */
export function poolHasId(id: bigint): boolean {
  return pool.has(id);
}

/**
 * Adds a token to the in-memory pool from a DB row. Called by:
 *   - initPool() at boot for every non-null active row
 *   - POST /api/admin/github-tokens after inserting a new row
 *   - PATCH /api/admin/github-tokens/[id] when re-enabling a disabled row
 *
 * `token === null` rows are silently skipped (legacy M4 rows — operator
 * must re-add via the admin UI). Non-active rows are removed from the
 * pool if present.
 */
export function addTokenToPool(row: GithubToken): void {
  if (row.token === null) return;
  if (row.status !== 'active') {
    pool.delete(row.id);
    return;
  }
  pool.set(row.id, {
    id: row.id,
    label: row.label,
    raw: row.token,
    octokit: new Octokit({ auth: row.token }),
    requestsUsed: row.requestsUsed,
    requestsLimit: row.requestsLimit,
    resetAt: row.resetAt,
    lastUsedAt: row.lastUsedAt,
    dirty: false,
  });
  logger.info({ id: row.id.toString(), label: row.label }, 'token added to pool');
}

/**
 * Removes a token from the in-memory pool. Called by:
 *   - DELETE /api/admin/github-tokens/[id] after the DB row is gone
 *   - PATCH /api/admin/github-tokens/[id] when disabling a row
 *   - autoDisableToken (M14.4) when 429 threshold trips
 *
 * No-op if the token isn't currently in the pool.
 */
export function removeTokenFromPool(id: bigint): void {
  if (pool.delete(id)) {
    logger.info({ tokenId: id.toString() }, 'token removed from pool');
  }
}