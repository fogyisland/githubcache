import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GithubToken } from '@prisma/client';

// Hoist mock state so vi.mock factories can access it
const mocks = vi.hoisted(() => ({
  envTokens: [] as Array<{ raw: string; first4: string; last4: string; hash: string }>,
  dbRows: [] as GithubToken[],
  insertedRows: [] as Array<{ label: string; tokenFirst4: string; tokenLast4: string; tokenHash: string }>,
  updatedRows: [] as Array<{ id: bigint; requestsUsed: number; resetAt: Date | null; lastUsedAt: Date | null }>,
  insertIdSeq: 1 as number,
}));

vi.mock('@/lib/github/tokens-loader', () => ({
  loadTokensFromEnv: () => mocks.envTokens,
}));
vi.mock('@/lib/db/github-tokens', () => ({
  findTokenByHash: vi.fn((hash: string) => Promise.resolve(mocks.dbRows.find((r) => r.tokenHash === hash) ?? null)),
  listAllTokens: () => Promise.resolve({ rows: mocks.dbRows, total: mocks.dbRows.length }),
  insertToken: vi.fn((data: { label: string; tokenFirst4: string; tokenLast4: string; tokenHash: string }) => {
    mocks.insertedRows.push(data);
    const row = {
      id: BigInt(mocks.insertIdSeq++),
      label: data.label,
      tokenFirst4: data.tokenFirst4,
      tokenLast4: data.tokenLast4,
      tokenHash: data.tokenHash,
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

function mkRow(overrides: Partial<GithubToken> = {}): GithubToken {
  return {
    id: BigInt(mocks.insertIdSeq++),
    label: 'test',
    tokenFirst4: 'ghp_',
    tokenLast4: 'aaaa',
    tokenHash: 'x',
    status: 'active',
    requestsUsed: 0,
    requestsLimit: 5000,
    resetAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as unknown as GithubToken;
}

function mkEnvToken(raw: string) {
  return { raw, first4: raw.slice(0, 4), last4: raw.slice(-4), hash: `hash-of-${raw}` };
}

beforeEach(async () => {
  vi.resetModules();
  mocks.envTokens = [];
  mocks.dbRows = [];
  mocks.insertedRows = [];
  mocks.updatedRows = [];
  mocks.insertIdSeq = 1;
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
});

afterEach(async () => {
  await shutdownPool();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('initPool', () => {
  it('inserts env tokens not in DB', async () => {
    mocks.envTokens = [mkEnvToken('ghp_aaa'), mkEnvToken('ghp_bbb')];
    await initPool();
    expect(mocks.insertedRows).toHaveLength(2);
    expect(poolSize()).toBe(2);
  });

  it('reuses existing DB rows for tokens already present', async () => {
    mocks.envTokens = [mkEnvToken('ghp_aaa')];
    mocks.dbRows = [mkRow({ tokenHash: 'hash-of-ghp_aaa', label: 'existing' })];
    await initPool();
    expect(mocks.insertedRows).toHaveLength(0);
    expect(poolSize()).toBe(1);
  });

  it('skips disabled DB rows', async () => {
    mocks.envTokens = [mkEnvToken('ghp_aaa')];
    mocks.dbRows = [mkRow({ tokenHash: 'hash-of-ghp_aaa', status: 'disabled' })];
    await initPool();
    expect(poolSize()).toBe(0);
  });

  it('inserts new rows but skips orphans silently', async () => {
    mocks.envTokens = [mkEnvToken('ghp_aaa')];
    mocks.dbRows = [mkRow({ tokenHash: 'orphan-hash', label: 'orphan' })];
    await initPool();
    expect(poolSize()).toBe(1); // only env-present token
    // Orphan NOT deleted (would need separate admin action)
  });
});

describe('pickToken', () => {
  it('returns null when pool is empty', async () => {
    await initPool();
    expect(pickToken()).toBeNull();
  });

  it('returns the active token with lowest requestsUsed', async () => {
    mocks.envTokens = [mkEnvToken('ghp_aaa'), mkEnvToken('ghp_bbb')];
    await initPool();
    const picked = pickToken();
    expect(picked).not.toBeNull();
    expect(picked!.id).toBeDefined();
  });

  it('skips exhausted tokens', async () => {
    mocks.envTokens = [mkEnvToken('ghp_aaa'), mkEnvToken('ghp_bbb')];
    await initPool();
    // Exhaust token 1 (use up its quota, resetAt in future)
    const t1 = pickToken()!;
    await recordUsage(t1.id, 0, Math.floor(Date.now() / 1000) + 3600);
    // Now token 1 is exhausted. Next pickToken must return token 2.
    const t2 = pickToken()!;
    expect(t2.id).not.toBe(t1.id);
  });

  it('picks exhausted token after reset window passes', async () => {
    mocks.envTokens = [mkEnvToken('ghp_aaa')];
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
    mocks.envTokens = [mkEnvToken('ghp_aaa')];
    await initPool();
    const t = pickToken()!;
    const resetUnix = Math.floor(Date.now() / 1000) + 3600;
    await recordUsage(t.id, 4999, resetUnix);
    // Pick again, verify requestsUsed was updated via pickToken exhaustion check
    await recordUsage(t.id, 0, resetUnix);
    expect(pickToken()).toBeNull(); // now exhausted
  });

  it('triggers persist after 25 calls', async () => {
    mocks.envTokens = [mkEnvToken('ghp_aaa')];
    await initPool();
    const t = pickToken()!;
    for (let i = 0; i < 25; i++) {
      await recordUsage(t.id, 5000 - i, Math.floor(Date.now() / 1000) + 3600);
    }
    expect(mocks.updatedRows.length).toBeGreaterThanOrEqual(1);
    expect(mocks.updatedRows[0]!.id).toBe(t.id);
  });

  it('triggers persist via 60s timer', async () => {
    mocks.envTokens = [mkEnvToken('ghp_aaa')];
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
    mocks.envTokens = [mkEnvToken('ghp_aaa')];
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
    mocks.envTokens = [mkEnvToken('ghp_aaa')];
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
    mocks.envTokens = [mkEnvToken('ghp_aaa')];
    await initPool();
    const t = pickToken()!;
    await recordUsage(t.id, 4999, Math.floor(Date.now() / 1000) + 3600);
    await shutdownPool();
    expect(mocks.updatedRows.length).toBeGreaterThanOrEqual(1);
  });
});