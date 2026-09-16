import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma before importing the module under test.
const mockRepositoryFindMany = vi.fn();
const mockPrismaQueryRawUnsafe = vi.fn();

vi.mock('@/lib/db/client', () => ({
  prisma: {
    repository: {
      findMany: (...args: unknown[]) => mockRepositoryFindMany(...args),
    },
    $queryRawUnsafe: (...args: unknown[]) => mockPrismaQueryRawUnsafe(...args),
  },
}));

import { dryRunImport } from '@/lib/import/dry-run';
import type { Pool, RowDataPacket } from 'mysql2/promise';

function makeFakePool(rows: RowDataPacket[]): {
  pool: Pool;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(async () => [rows]);
  // Minimal Pool surface used by dryRunImport: `.query(sql) -> [rows, fields]`.
  const pool = { query: spy } as unknown as Pool;
  return { pool, spy };
}

describe('dryRunImport', () => {
  beforeEach(() => {
    mockRepositoryFindMany.mockReset();
    mockPrismaQueryRawUnsafe.mockReset();
  });

  it('empty source table: returns all zeros', async () => {
    const { pool, spy } = makeFakePool([]);
    const r = await dryRunImport({ sourcePool: pool, table: 'repositories' });
    expect(r).toEqual({
      table: 'repositories',
      willInsert: 0,
      willSkip: 0,
      willFail: 0,
      sampleRows: [],
    });
    expect(spy).toHaveBeenCalledOnce();
    const sql = spy.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/SELECT.*FROM `repositories`/);
    expect(sql).toMatch(/LIMIT/);
  });

  it('all-source-rows-new: willInsert = row count, willSkip = 0', async () => {
    const rows = [
      {
        owner: 'foo',
        name: 'bar',
        stars: 100,
        topics: '["js"]',
        fetch_status: 'ok',
        created_at: new Date('2026-01-01'),
      },
      {
        owner: 'baz',
        name: 'qux',
        stars: 5,
        topics: '[]',
        fetch_status: 'ok',
        created_at: new Date('2026-01-02'),
      },
    ] as unknown as RowDataPacket[];
    const { pool } = makeFakePool(rows);

    // No existing target rows → empty Set.
    mockPrismaQueryRawUnsafe.mockResolvedValueOnce([]);

    const r = await dryRunImport({ sourcePool: pool, table: 'repositories' });
    expect(r.table).toBe('repositories');
    expect(r.willInsert).toBe(2);
    expect(r.willSkip).toBe(0);
    expect(r.willFail).toBe(0);
    expect(r.sampleRows.length).toBe(2);
  });

  it('all-source-rows-existing: willSkip = row count, willInsert = 0', async () => {
    const rows = [
      { owner: 'foo', name: 'bar', fetch_status: 'ok', created_at: new Date() },
      { owner: 'baz', name: 'qux', fetch_status: 'ok', created_at: new Date() },
    ] as unknown as RowDataPacket[];
    const { pool } = makeFakePool(rows);

    // Target has both rows.
    mockPrismaQueryRawUnsafe.mockResolvedValueOnce([
      { owner: 'foo', name: 'bar' },
      { owner: 'baz', name: 'qux' },
    ]);

    const r = await dryRunImport({ sourcePool: pool, table: 'repositories' });
    expect(r.willInsert).toBe(0);
    expect(r.willSkip).toBe(2);
  });

  it('mixed: existing + new keys are split correctly', async () => {
    const rows = [
      { owner: 'a', name: '1', fetch_status: 'ok', created_at: new Date() },
      { owner: 'b', name: '2', fetch_status: 'ok', created_at: new Date() },
      { owner: 'c', name: '3', fetch_status: 'ok', created_at: new Date() },
    ] as unknown as RowDataPacket[];
    const { pool } = makeFakePool(rows);

    // Target has 'a/1' and 'c/3'.
    mockPrismaQueryRawUnsafe.mockResolvedValueOnce([
      { owner: 'a', name: '1' },
      { owner: 'c', name: '3' },
    ]);

    const r = await dryRunImport({ sourcePool: pool, table: 'repositories' });
    expect(r.willInsert).toBe(1); // b/2
    expect(r.willSkip).toBe(2); // a/1, c/3
  });

  it('repo_releases with missing repositoryId: counts willFail', async () => {
    const rows = [
      { repository_id: 100, tag: 'v1.0', published_at: new Date(), fetched_at: new Date(), prerelease: 0, draft: 0 },
      { repository_id: 999, tag: 'v2.0', published_at: new Date(), fetched_at: new Date(), prerelease: 0, draft: 0 }, // missing target repo
    ] as unknown as RowDataPacket[];
    const { pool } = makeFakePool(rows);

    // No existing releases in target.
    mockPrismaQueryRawUnsafe.mockResolvedValueOnce([]);
    // Target repositories has only id=100.
    mockRepositoryFindMany.mockResolvedValueOnce([{ id: 100n }]);

    const r = await dryRunImport({ sourcePool: pool, table: 'repo_releases' });
    expect(r.willInsert).toBe(2); // both pass the unique-key check
    expect(r.willSkip).toBe(0);
    expect(r.willFail).toBe(1); // repo 999 doesn't exist in target
  });

  it('repo_branches with missing repositoryId: counts willFail', async () => {
    const rows = [
      { repository_id: 1, name: 'main', protected: 0, fetched_at: new Date() },
      { repository_id: 42, name: 'dev', protected: 1, fetched_at: new Date() }, // missing
    ] as unknown as RowDataPacket[];
    const { pool } = makeFakePool(rows);

    mockPrismaQueryRawUnsafe.mockResolvedValueOnce([]);
    mockRepositoryFindMany.mockResolvedValueOnce([{ id: 1n }]);

    const r = await dryRunImport({ sourcePool: pool, table: 'repo_branches' });
    expect(r.willFail).toBe(1);
  });

  it('ingestion_providers: unique key is slug', async () => {
    const rows = [
      { slug: 'github', name: 'GitHub', source_type: 'json', config_json: '{}', enabled: 1, created_at: new Date(), updated_at: new Date() },
    ] as unknown as RowDataPacket[];
    const { pool } = makeFakePool(rows);

    mockPrismaQueryRawUnsafe.mockResolvedValueOnce([]);
    const r = await dryRunImport({ sourcePool: pool, table: 'ingestion_providers' });
    expect(r.willInsert).toBe(1);
    // The SELECT SQL targets `ingestion_providers` and includes
    // `config_json` (snake_case) — not `configJson`.
    expect(r.sampleRows[0]).toMatchObject({ slug: 'github' });
  });

  it('sampleRows: capped at 5 rows even if source has 100', async () => {
    const rows: RowDataPacket[] = [];
    for (let i = 0; i < 100; i++) {
      rows.push({
        owner: `o${i}`,
        name: `n${i}`,
        fetch_status: 'ok',
        created_at: new Date(),
      } as unknown as RowDataPacket);
    }
    const { pool } = makeFakePool(rows);

    mockPrismaQueryRawUnsafe.mockResolvedValueOnce([]);

    const r = await dryRunImport({ sourcePool: pool, table: 'repositories' });
    expect(r.sampleRows.length).toBe(5);
    expect(r.willInsert).toBe(100);
  });

  it('sampleRows: dates serialised to ISO strings for JSON', async () => {
    const date = new Date('2026-01-01T00:00:00Z');
    const rows = [
      { owner: 'a', name: 'b', fetch_status: 'ok', created_at: date },
    ] as unknown as RowDataPacket[];
    const { pool } = makeFakePool(rows);

    mockPrismaQueryRawUnsafe.mockResolvedValueOnce([]);
    const r = await dryRunImport({ sourcePool: pool, table: 'repositories' });
    const first = r.sampleRows[0] as { createdAt: string };
    expect(typeof first.createdAt).toBe('string');
    expect(first.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('respects maxRows option: source SELECT gets LIMIT clause', async () => {
    const { pool, spy } = makeFakePool([]);
    await dryRunImport({ sourcePool: pool, table: 'repositories', maxRows: 42 });
    const sql = spy.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/LIMIT 42/);
  });
});