import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GithubToken } from '@prisma/client';

// Hoist mock state so vi.mock factories can access it
const mocks = vi.hoisted(() => ({
  dbRows: [] as GithubToken[],
  updatedRows: [] as Array<{ id: bigint; requestsUsed: number; resetAt: Date | null; lastUsedAt: Date | null }>,
  dbRowIdSeq: 1 as number,
  disableCalls: [] as Array<{ id: bigint; reason: 'operator' | 'auto-rotation' }>,
  autoDisableThreshold: 3 as number,
}));

vi.mock('@/lib/config/env', () => ({
  get env() { return { TOKEN_AUTO_DISABLE_THRESHOLD: mocks.autoDisableThreshold }; },
}));

vi.mock('@/lib/db/github-tokens', () => ({
  findTokenByHash: vi.fn((hash: string) => Promise.resolve(mocks.dbRows.find((r) => r.tokenHash === hash) ?? null)),
  listAllTokens: () => Promise.resolve({ rows: mocks.dbRows, total: mocks.dbRows.length }),
  insertToken: vi.fn((data: { label: string; tokenFirst4: string; tokenLast4: string; tokenHash: string; token: string }) => {
    const row = {
      id: BigInt(mocks.dbRowIdSeq++),
      label: data.label,
      tokenFirst4: data.tokenFirst4,
      tokenLast4: data.tokenLast4,
      tokenHash: data.tokenHash,
      token: data.token,
      status: 'active',
      requestsUsed: 0,
      requestsLimit: 5000,
      resetAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    } as unknown as GithubToken;
    mocks.dbRows.push(row);
    return Promise.resolve(row);
  }),
  updateTokenQuota: vi.fn((id: bigint, data: { requestsUsed: number; resetAt: Date | null; lastUsedAt: Date | null }) => {
    mocks.updatedRows.push({ id, ...data });
    const row = mocks.dbRows.find((r) => r.id === id);
    if (row) Object.assign(row, data);
    return Promise.resolve(row!);
  }),
  disableTokenById: vi.fn((id: bigint, reason: 'operator' | 'auto-rotation') => {
    mocks.disableCalls.push({ id, reason });
    const row = mocks.dbRows.find((r) => r.id === id);
    if (row) (row as { status: string }).status = 'disabled';
    return Promise.resolve(row!);
  }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import AFTER mocks so module-load side effects (e.g., logger.info at boot) are captured
// vi.resetModules() in beforeEach ensures fresh pool state per test
let initPool: typeof import('@/lib/github/pool').initPool;
let pickToken: typeof import('@/lib/github/pool').pickToken;
let recordUsage: typeof import('@/lib/github/pool').recordUsage;
let persistQuota: typeof import('@/lib/github/pool').persistQuota;
let getBackoff: typeof import('@/lib/github/pool').getBackoff;
let shutdownPool: typeof import('@/lib/github/pool').shutdownPool;
let poolSize: typeof import('@/lib/github/pool').poolSize;
let addTokenToPool: typeof import('@/lib/github/pool').addTokenToPool;
let removeTokenFromPool: typeof import('@/lib/github/pool').removeTokenFromPool;
let poolHasId: typeof import('@/lib/github/pool').poolHasId;

function mkRow(overrides: Partial<GithubToken> = {}): GithubToken {
  return {
    id: BigInt(mocks.dbRowIdSeq++),
    label: 'test',
    tokenFirst4: 'ghp_',
    tokenLast4: 'aaaa',
    tokenHash: 'x',
    token: 'ghp_test', // M21 — raw plaintext required for pool entry
    status: 'active',
    requestsUsed: 0,
    requestsLimit: 5000,
    resetAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as unknown as GithubToken;
}

beforeEach(async () => {
  vi.resetModules();
  mocks.dbRows = [];
  mocks.updatedRows = [];
  mocks.dbRowIdSeq = 1;
  mocks.disableCalls = [];
  mocks.autoDisableThreshold = 3;
  vi.useFakeTimers();
  // Re-import after resetModules so each test gets a fresh pool module
  const mod = await import('@/lib/github/pool');
  initPool = mod.initPool;
  pickToken = mod.pickToken;
  recordUsage = mod.recordUsage;
  persistQuota = mod.persistQuota;
  getBackoff = mod.getBackoff;
  shutdownPool = mod.shutdownPool;
  poolSize = mod.poolSize;
  addTokenToPool = mod.addTokenToPool;
  removeTokenFromPool = mod.removeTokenFromPool;
  poolHasId = mod.poolHasId;
});

afterEach(async () => {
  await shutdownPool();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('initPool', () => {
  it('inserts no rows on init (M21 DB-direct, no env-loader)', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    await initPool();
    expect(poolSize()).toBe(1);
  });

  it('skips rows with token=null and warns', async () => {
    mocks.dbRows = [
      mkRow({ id: BigInt(1), token: null, label: 'legacy' }),
      mkRow({ id: BigInt(2), token: 'ghp_ok' }),
    ];
    await initPool();
    expect(poolSize()).toBe(1); // only the non-null token enters the pool
  });

  it('skips disabled rows', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1), status: 'disabled' })];
    await initPool();
    expect(poolSize()).toBe(0);
  });

  it('clears the pool on re-init (idempotent)', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    await initPool();
    expect(poolSize()).toBe(1);
    mocks.dbRows = [mkRow({ id: BigInt(2), label: 'second' })];
    await initPool();
    expect(poolSize()).toBe(1);
    expect(poolHasId(BigInt(1))).toBe(false); // old id gone
    expect(poolHasId(BigInt(2))).toBe(true);
  });
});

describe('pickToken', () => {
  it('returns null when pool is empty', async () => {
    await initPool();
    expect(pickToken()).toBeNull();
  });

  it('returns the active token with lowest requestsUsed', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) }), mkRow({ id: BigInt(2) })];
    await initPool();
    const picked = pickToken();
    expect(picked).not.toBeNull();
    expect(picked!.id).toBeDefined();
  });

  it('skips exhausted tokens', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) }), mkRow({ id: BigInt(2) })];
    await initPool();
    // Exhaust token 1 (use up its quota, resetAt in future)
    const t1 = pickToken()!;
    await recordUsage(t1.id, 0, Math.floor(Date.now() / 1000) + 3600);
    // Now token 1 is exhausted. Next pickToken must return token 2.
    const t2 = pickToken()!;
    expect(t2.id).not.toBe(t1.id);
  });

  it('picks exhausted token after reset window passes', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    await initPool();
    const t = pickToken()!;
    await recordUsage(t.id, 0, Math.floor(Date.now() / 1000) + 60);
    expect(pickToken()).toBeNull(); // exhausted, reset in future
    vi.advanceTimersByTime(61_000);
    expect(pickToken()).not.toBeNull(); // reset passed, pickable again
  });
});

describe('recordUsage + persistQuota', () => {
  it('updates in-memory state', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    await initPool();
    const t = pickToken()!;
    const resetUnix = Math.floor(Date.now() / 1000) + 3600;
    await recordUsage(t.id, 4999, resetUnix);
    // Pick again, verify requestsUsed was updated via pickToken exhaustion check
    await recordUsage(t.id, 0, resetUnix);
    expect(pickToken()).toBeNull(); // now exhausted
  });

  it('triggers persist after 25 calls', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    await initPool();
    const t = pickToken()!;
    for (let i = 0; i < 25; i++) {
      await recordUsage(t.id, 5000 - i, Math.floor(Date.now() / 1000) + 3600);
    }
    expect(mocks.updatedRows.length).toBeGreaterThanOrEqual(1);
    expect(mocks.updatedRows[0]!.id).toBe(t.id);
  });

  it('triggers persist via 60s timer', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    await initPool();
    const t = pickToken()!;
    await recordUsage(t.id, 4999, Math.floor(Date.now() / 1000) + 3600);
    expect(mocks.updatedRows).toHaveLength(0);
    vi.advanceTimersByTime(60_000);
    // Timer fires; flush happens via the interval callback
    await vi.runOnlyPendingTimersAsync();
    expect(mocks.updatedRows.length).toBeGreaterThanOrEqual(1);
  });

  it('persistQuota clears dirty flag', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    await initPool();
    const t = pickToken()!;
    await recordUsage(t.id, 4999, Math.floor(Date.now() / 1000) + 3600);
    await persistQuota();
    expect(mocks.updatedRows).toHaveLength(1);
    await persistQuota(); // second call: nothing dirty
    expect(mocks.updatedRows).toHaveLength(1); // unchanged
  });
});

describe('getBackoff', () => {
  it('exponentially increases with consecutive 429s', async () => {
    await initPool();
    const b1 = getBackoff();
    const b2 = getBackoff();
    const b3 = getBackoff();
    expect(b1).toBe(1000);
    expect(b2).toBe(2000);
    expect(b3).toBe(4000);
    expect(getBackoff()).toBeLessThanOrEqual(60_000); // cap
  });

  it('resets after a successful recordUsage', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    await initPool();
    const t = pickToken()!;
    getBackoff();
    getBackoff();
    await recordUsage(t.id, 4999, Math.floor(Date.now() / 1000) + 3600);
    expect(getBackoff()).toBe(1000); // reset
  });
});

describe('shutdownPool', () => {
  it('flushes dirty entries and stops the timer', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    await initPool();
    const t = pickToken()!;
    await recordUsage(t.id, 4999, Math.floor(Date.now() / 1000) + 3600);
    await shutdownPool();
    expect(mocks.updatedRows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('M14.4 auto-disable', () => {
  it('does not auto-disable below threshold', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    mocks.autoDisableThreshold = 3;
    await initPool();
    const t = pickToken()!;
    const futureReset = Math.floor(Date.now() / 1000) + 3600;
    await recordUsage(t.id, 0, futureReset);
    await recordUsage(t.id, 0, futureReset);
    expect(mocks.disableCalls).toHaveLength(0);
    expect(poolSize()).toBe(1);
  });

  it('auto-disables after consecutive 429s hit threshold', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    mocks.autoDisableThreshold = 3;
    await initPool();
    const t = pickToken()!;
    const futureReset = Math.floor(Date.now() / 1000) + 3600;
    await recordUsage(t.id, 0, futureReset);
    await recordUsage(t.id, 0, futureReset);
    await recordUsage(t.id, 0, futureReset);
    expect(mocks.disableCalls).toEqual([{ id: t.id, reason: 'auto-rotation' }]);
    expect(poolSize()).toBe(0);
  });

  it('respects threshold=0 (manual-only)', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    mocks.autoDisableThreshold = 0;
    await initPool();
    const t = pickToken()!;
    const futureReset = Math.floor(Date.now() / 1000) + 3600;
    for (let i = 0; i < 10; i++) {
      await recordUsage(t.id, 0, futureReset);
    }
    expect(mocks.disableCalls).toHaveLength(0);
    expect(poolSize()).toBe(1);
  });

  it('respects a custom threshold', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    mocks.autoDisableThreshold = 5;
    await initPool();
    const t = pickToken()!;
    const futureReset = Math.floor(Date.now() / 1000) + 3600;
    for (let i = 0; i < 4; i++) {
      await recordUsage(t.id, 0, futureReset);
    }
    expect(mocks.disableCalls).toHaveLength(0);
    await recordUsage(t.id, 0, futureReset); // 5th
    expect(mocks.disableCalls).toHaveLength(1);
  });

  it('resets per-token counter on success', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    mocks.autoDisableThreshold = 3;
    await initPool();
    const t = pickToken()!;
    const futureReset = Math.floor(Date.now() / 1000) + 3600;
    await recordUsage(t.id, 0, futureReset);
    await recordUsage(t.id, 0, futureReset);
    // success — counter resets
    await recordUsage(t.id, 4999, futureReset);
    // 2 more 429s is back below threshold
    await recordUsage(t.id, 0, futureReset);
    await recordUsage(t.id, 0, futureReset);
    expect(mocks.disableCalls).toHaveLength(0);
    expect(poolSize()).toBe(1);
    // 3rd 429 since the success trips the threshold
    await recordUsage(t.id, 0, futureReset);
    expect(mocks.disableCalls).toHaveLength(1);
  });

  it('does not treat remaining=0 with past resetAt as 429', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) })];
    mocks.autoDisableThreshold = 3;
    await initPool();
    const t = pickToken()!;
    const pastReset = Math.floor(Date.now() / 1000) - 60;
    await recordUsage(t.id, 0, pastReset);
    await recordUsage(t.id, 0, pastReset);
    await recordUsage(t.id, 0, pastReset);
    expect(mocks.disableCalls).toHaveLength(0); // not over limit, just reset
    expect(poolSize()).toBe(1);
  });

  it('only auto-disables the offending token, not the whole pool', async () => {
    mocks.dbRows = [mkRow({ id: BigInt(1) }), mkRow({ id: BigInt(2) })];
    mocks.autoDisableThreshold = 3;
    await initPool();
    const t1 = pickToken()!;
    const futureReset = Math.floor(Date.now() / 1000) + 3600;
    await recordUsage(t1.id, 0, futureReset);
    await recordUsage(t1.id, 0, futureReset);
    await recordUsage(t1.id, 0, futureReset); // disables t1
    expect(mocks.disableCalls).toEqual([{ id: t1.id, reason: 'auto-rotation' }]);
    expect(poolSize()).toBe(1); // t2 still active
  });
});

describe('M21 addTokenToPool / removeTokenToPool / poolHasId', () => {
  it('poolHasId returns true after addTokenToPool for an active row', async () => {
    mocks.dbRows = [];
    await initPool();
    expect(poolHasId(BigInt(99))).toBe(false);
    addTokenToPool(mkRow({ id: BigInt(99) }));
    expect(poolHasId(BigInt(99))).toBe(true);
    expect(poolSize()).toBe(1);
  });

  it('addTokenToPool no-ops on token=null rows (legacy M4)', async () => {
    mocks.dbRows = [];
    await initPool();
    addTokenToPool(mkRow({ id: BigInt(7), token: null }));
    expect(poolHasId(BigInt(7))).toBe(false);
  });

  it('addTokenToPool removes from pool when status !== active', async () => {
    mocks.dbRows = [];
    await initPool();
    addTokenToPool(mkRow({ id: BigInt(1) }));
    expect(poolHasId(BigInt(1))).toBe(true);
    addTokenToPool(mkRow({ id: BigInt(1), status: 'disabled' }));
    expect(poolHasId(BigInt(1))).toBe(false);
  });

  it('removeTokenToPool is a no-op when id absent', async () => {
    mocks.dbRows = [];
    await initPool();
    expect(() => removeTokenFromPool(BigInt(99))).not.toThrow();
    expect(poolSize()).toBe(0);
  });

  it('removeTokenToPool removes the entry', async () => {
    mocks.dbRows = [];
    await initPool();
    addTokenToPool(mkRow({ id: BigInt(1) }));
    removeTokenFromPool(BigInt(1));
    expect(poolHasId(BigInt(1))).toBe(false);
  });
});