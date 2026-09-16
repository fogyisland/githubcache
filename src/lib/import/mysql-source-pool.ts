import crypto from 'node:crypto';
import mysql, { type Pool } from 'mysql2/promise';

/**
 * Source-side connection spec — typed user input from the import form
 * (or from the test/dry-run/apply API routes).
 *
 * Never persisted: `password` is held only in process memory while a
 * pool is alive. The route handlers must clear it after the request.
 */
export type SourceSpec = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

/**
 * Spec hash used as the cache key for `getSourcePool` so two requests
 * with identical credentials share a pool. The hash includes only the
 * structural fields — password is part of the spec but does NOT
 * appear in the key string (we hash the spec, never log it).
 */
function specKey(spec: SourceSpec): string {
  const h = crypto.createHash('sha256');
  h.update(`${spec.host}|${spec.port}|${spec.user}|${spec.database}`);
  return h.digest('hex').slice(0, 16);
}

type PoolEntry = {
  pool: Pool;
  /** Last-used timestamp (ms since epoch). Used by the LRU sweeper. */
  lastUsed: number;
};

const IDLE_TIMEOUT_MS = 60_000;
const SWEEP_INTERVAL_MS = 30_000;
const MAX_POOLS = 32;

/**
 * Process-wide singleton map of source connection pools. Pinned to
 * `globalThis` so it survives Next.js dev HMR and webpack split-chunks
 * route-worker isolation, mirroring the pattern in
 * `src/lib/github/pool.ts` (M32.7).
 */
type GlobalShape = typeof globalThis & {
  __importSourcePools?: Map<string, PoolEntry>;
  __importSourceSweeper?: NodeJS.Timeout;
};
const g = globalThis as GlobalShape;

function getStore(): Map<string, PoolEntry> {
  if (g.__importSourcePools === undefined) {
    g.__importSourcePools = new Map();
  }
  return g.__importSourcePools;
}

function getSweeper(): NodeJS.Timeout {
  if (g.__importSourceSweeper === undefined) {
    g.__importSourceSweeper = setInterval(() => {
      sweepIdlePools().catch((e: unknown) => {
        // The sweeper is fire-and-forget. Log and keep going.
        // eslint-disable-next-line no-console
        console.error('[import-pool] sweeper failed:', e);
      });
      // Don't keep the process alive on the sweeper timer alone.
      g.__importSourceSweeper?.unref();
    }, SWEEP_INTERVAL_MS);
  }
  return g.__importSourceSweeper;
}

/**
 * Look up or create a `mysql2/promise` pool for the given spec.
 *
 * Pool size is capped at 2 — the dry-run and apply paths only ever
 * hold one connection in flight at a time, and this is a one-shot
 * admin op, not a high-throughput path.
 */
export async function getSourcePool(spec: SourceSpec): Promise<Pool> {
  const key = specKey(spec);
  const store = getStore();
  const existing = store.get(key);
  if (existing !== undefined) {
    existing.lastUsed = Date.now();
    return existing.pool;
  }

  // Bound the cache: drop the oldest entry if we're at the cap.
  if (store.size >= MAX_POOLS) {
    const oldestKey = [...store.entries()].sort(
      (a, b) => a[1].lastUsed - b[1].lastUsed,
    )[0]?.[0];
    if (oldestKey !== undefined) {
      const dropped = store.get(oldestKey);
      store.delete(oldestKey);
      await dropped?.pool.end().catch(() => {
        // Best-effort close. If the connection is half-open we lose
        // it on the OS side anyway.
      });
    }
  }

  const pool = mysql.createPool({
    host: spec.host,
    port: spec.port,
    user: spec.user,
    password: spec.password,
    database: spec.database,
    waitForConnections: true,
    connectionLimit: 2,
    enableKeepAlive: true,
  });

  // Probe the pool to fail fast if the spec is bogus. This also
  // blocks the caller once (negligible) and surfaces auth errors as
  // a thrown exception the route can convert to 401/422.
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();

  store.set(key, { pool, lastUsed: Date.now() });
  getSweeper(); // start lazy
  return pool;
}

/**
 * Close the pool for a spec (test cleanup path). Idempotent: returns
 * silently if no pool exists for the key.
 */
export async function closeSourcePool(spec: SourceSpec): Promise<void> {
  const key = specKey(spec);
  const store = getStore();
  const entry = store.get(key);
  if (entry === undefined) return;
  store.delete(key);
  await entry.pool.end().catch(() => {
    // Already-closed pool; swallow.
  });
}

/**
 * Close ALL source pools. Called by integration tests in afterAll.
 */
export async function closeAllSourcePools(): Promise<void> {
  const store = getStore();
  const all = [...store.values()];
  store.clear();
  for (const entry of all) {
    await entry.pool.end().catch(() => {
      // ignore
    });
  }
  if (g.__importSourceSweeper !== undefined) {
    clearInterval(g.__importSourceSweeper);
    delete g.__importSourceSweeper;
  }
}

/**
 * Internal: called periodically by the sweeper interval. Closes pools
 * that haven't been used in `IDLE_TIMEOUT_MS`.
 */
async function sweepIdlePools(): Promise<void> {
  const now = Date.now();
  const store = getStore();
  const expired: Array<[string, PoolEntry]> = [];
  for (const [key, entry] of store) {
    if (now - entry.lastUsed > IDLE_TIMEOUT_MS) {
      expired.push([key, entry]);
    }
  }
  for (const [key, entry] of expired) {
    store.delete(key);
    await entry.pool.end().catch(() => {
      // ignore
    });
  }
}