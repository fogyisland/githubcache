import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  listAllTokens,
  getTokenById,
  insertToken,
  updateTokenStatus,
  deleteTokenById,
  disableTokenById,
  updateTokenRaw,
} from '@/lib/db/github-tokens';
import { prisma } from '@/lib/db/client';
import { createHash } from 'crypto';

const TEST_TOKEN_LABEL_PREFIX = 'dbgt-';

let testTokenIds: bigint[] = [];
let insertedRows: bigint[] = [];

beforeAll(async () => {
  // No users required for these tests
}, 30_000);

afterAll(async () => {
  // Clean up all tokens created in tests
  if (testTokenIds.length > 0) {
    await prisma.githubToken.deleteMany({
      where: { id: { in: testTokenIds } },
    });
  }
  if (insertedRows.length > 0) {
    await prisma.githubToken.deleteMany({
      where: { id: { in: insertedRows } },
    });
  }
  await prisma.githubToken.deleteMany({
    where: { label: { startsWith: TEST_TOKEN_LABEL_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Clean between tests — delete anything with the prefix
  await prisma.githubToken.deleteMany({
    where: { label: { startsWith: TEST_TOKEN_LABEL_PREFIX } },
  });
  testTokenIds = [];
  insertedRows = [];
});

async function mkRow(label: string): Promise<bigint> {
  // Use a unique hash per call so we don't collide on the unique index
  const raw = `ghp_${label}-${Math.random().toString(36).slice(2, 10)}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const row = await insertToken({
    label: `${TEST_TOKEN_LABEL_PREFIX}${label}`,
    tokenFirst4: raw.slice(0, 4),
    tokenLast4: raw.slice(-4),
    tokenHash: hash,
  });
  testTokenIds.push(row.id);
  return row.id;
}

describe('listAllTokens', () => {
  it('returns existing token rows (including ones we just inserted)', async () => {
    await mkRow('list-a');
    await mkRow('list-b');
    const all = await listAllTokens({ skip: 0, take: 1000 });
    const ours = all.rows.filter((t) => t.label.startsWith(TEST_TOKEN_LABEL_PREFIX));
    expect(ours.length).toBeGreaterThanOrEqual(2);
    for (const t of ours) {
      expect(t.id).toBeDefined();
      expect(typeof t.tokenHash).toBe('string');
      expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('getTokenById', () => {
  it('returns the row when found', async () => {
    const id = await mkRow('get-found');
    const row = await getTokenById(id);
    expect(row).not.toBeNull();
    expect(row!.id).toBe(id);
    expect(row!.label).toBe(`${TEST_TOKEN_LABEL_PREFIX}get-found`);
    expect(row!.status).toBe('active');
  });

  it('returns null when not found', async () => {
    const row = await getTokenById(BigInt('999999999999'));
    expect(row).toBeNull();
  });
});

describe('updateTokenStatus', () => {
  it('flips active to disabled and returns updated row', async () => {
    const id = await mkRow('flip-1');
    const before = await getTokenById(id);
    expect(before!.status).toBe('active');

    const updated = await updateTokenStatus(id, 'disabled');
    expect(updated.id).toBe(id);
    expect(updated.status).toBe('disabled');

    // Persisted in DB
    const after = await getTokenById(id);
    expect(after!.status).toBe('disabled');
  });

  it('flips disabled back to active', async () => {
    const id = await mkRow('flip-2');
    await updateTokenStatus(id, 'disabled');
    const updated = await updateTokenStatus(id, 'active');
    expect(updated.status).toBe('active');
  });

  it('throws when id does not exist', async () => {
    await expect(
      updateTokenStatus(BigInt('999999999999'), 'disabled'),
    ).rejects.toBeDefined();
  });
});

describe('deleteTokenById', () => {
  it('removes the row and count decreases by 1', async () => {
    const id = await mkRow('delete-1');
    const before = await listAllTokens({ skip: 0, take: 1000 });
    const beforeOurs = before.rows.filter((t) => t.label.startsWith(TEST_TOKEN_LABEL_PREFIX));
    expect(beforeOurs.length).toBe(1);

    await deleteTokenById(id);

    const after = await listAllTokens({ skip: 0, take: 1000 });
    const afterOurs = after.rows.filter((t) => t.label.startsWith(TEST_TOKEN_LABEL_PREFIX));
    expect(afterOurs.length).toBe(0);
    // Subsequent getTokenById returns null
    expect(await getTokenById(id)).toBeNull();
  });

  it('throws when id does not exist', async () => {
    await expect(deleteTokenById(BigInt('999999999999'))).rejects.toBeDefined();
  });
});

describe('insertToken', () => {
  it('inserts a new row with the supplied fields and defaults', async () => {
    const raw = 'ghp_unique-' + Math.random().toString(36).slice(2, 10);
    const hash = createHash('sha256').update(raw).digest('hex');
    const row = await insertToken({
      label: `${TEST_TOKEN_LABEL_PREFIX}insert-defaults`,
      tokenFirst4: raw.slice(0, 4),
      tokenLast4: raw.slice(-4),
      tokenHash: hash,
    });
    insertedRows.push(row.id);

    expect(row.label).toBe(`${TEST_TOKEN_LABEL_PREFIX}insert-defaults`);
    expect(row.status).toBe('active'); // schema default
    expect(row.requestsUsed).toBe(0); // schema default
    expect(row.requestsLimit).toBe(5000); // schema default
    expect(row.tokenFirst4).toHaveLength(4);
    expect(row.tokenLast4).toHaveLength(4);
    expect(row.tokenHash).toBe(hash);
  });
});

describe('disableTokenById (M14.4)', () => {
  it('flips status to disabled synchronously', async () => {
    const id = await mkRow('auto-disable-1');
    const before = await getTokenById(id);
    expect(before!.status).toBe('active');

    const updated = await disableTokenById(id, 'auto-rotation');
    expect(updated.status).toBe('disabled');
    // Persisted in DB
    const after = await getTokenById(id);
    expect(after!.status).toBe('disabled');
  });

  it('idempotent — calling twice still disables', async () => {
    const id = await mkRow('auto-disable-2');
    await disableTokenById(id, 'auto-rotation');
    const updated = await disableTokenById(id, 'auto-rotation');
    expect(updated.status).toBe('disabled');
  });
});

describe('updateTokenRaw (M21)', () => {
  it('overwrites token + recomputes first4/last4/hash', async () => {
    const id = await mkRow('update-raw-1');
    const newRaw = 'ghp_brand-new-token-1234567890ab';
    const expectedLast4 = newRaw.slice(-4); // '90ab'
    const expectedHash = createHash('sha256').update(newRaw).digest('hex');
    const oldRow = await getTokenById(id);
    const oldHash = oldRow!.tokenHash;

    const updated = await updateTokenRaw(id, newRaw);

    expect(updated.id).toBe(id);
    expect(updated.token).toBe(newRaw);
    expect(updated.tokenFirst4).toBe('ghp_');
    expect(updated.tokenLast4).toBe(expectedLast4);
    expect(updated.tokenHash).toBe(expectedHash);
    expect(updated.tokenHash).not.toBe(oldHash);

    // Persisted in DB
    const after = await getTokenById(id);
    expect(after!.token).toBe(newRaw);
    expect(after!.tokenFirst4).toBe('ghp_');
    expect(after!.tokenLast4).toBe(expectedLast4);
    expect(after!.tokenHash).toBe(expectedHash);
  });

  it('preserves row id and label', async () => {
    const id = await mkRow('update-raw-2');
    const before = await getTokenById(id);
    const expectedLabel = before!.label;

    const newRaw = 'ghp_another-fresh-token-aabbccdd';
    const updated = await updateTokenRaw(id, newRaw);

    expect(updated.id).toBe(id);
    expect(updated.label).toBe(expectedLabel);
  });

  it('handles short tokens (last4 === full token)', async () => {
    const id = await mkRow('update-raw-3');
    const shortToken = 'abcd';
    const expectedHash = createHash('sha256').update(shortToken).digest('hex');

    const updated = await updateTokenRaw(id, shortToken);

    expect(updated.token).toBe(shortToken);
    expect(updated.tokenFirst4).toBe('abcd');
    expect(updated.tokenLast4).toBe(shortToken); // full token when len < 4
    expect(updated.tokenHash).toBe(expectedHash);

    // Persisted in DB
    const after = await getTokenById(id);
    expect(after!.token).toBe(shortToken);
    expect(after!.tokenLast4).toBe(shortToken);
  });
});
