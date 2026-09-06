import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` factories are hoisted to the top of the file, before any
// `const`/`let` declarations. Use `vi.hoisted` to create state that the
// factory can read at hoisted time.
const envState = vi.hoisted(() => ({
  // pino + the logger module-load require these even when the sweep
  // module is the only thing under test. They sit here at hoisted
  // time so the vi.mock factory sees them.
  values: { LOG_LEVEL: 'info', NODE_ENV: 'test' } as Record<string, unknown>,
}));

vi.mock('@/lib/config/env', () => ({
  get env() {
    return envState.values;
  },
}));

const findManyMock = vi.fn();
const createManyMock = vi.fn();
vi.mock('@/lib/db/client', () => ({
  get prisma() {
    return {
      repository: { findMany: findManyMock },
      refreshJob: { createMany: createManyMock },
    };
  },
}));

// Now safe to import the module under test.
import { coreSweep, releasesSweep, branchesSweep } from '@/lib/scheduler/sweep';

describe('M27.5 per-facet sweep — freshness gating', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    createManyMock.mockReset();
    createManyMock.mockResolvedValue({ count: 0 });
    findManyMock.mockResolvedValue([]);
    envState.values = {};
  });

  it('coreSweep uses lastFetchedAt as the freshness column', async () => {
    findManyMock.mockResolvedValue([{ id: 1n }]);
    envState.values = { SCHEDULER_CORE_SWEEP_HOURS: 168 };
    await coreSweep();
    expect(findManyMock).toHaveBeenCalledTimes(1);
    const where = findManyMock.mock.calls[0]![0].where;
    expect(where.fetchStatus).toBe('ok');
    expect(where.lastFetchedAt).toBeDefined();
    expect(where.lastFetchedAt.lt).toBeInstanceOf(Date);
    expect(where.releasesFetchedAt).toBeUndefined();
    expect(where.branchesFetchedAt).toBeUndefined();
  });

  it('releasesSweep uses releasesFetchedAt as the freshness column', async () => {
    findManyMock.mockResolvedValue([{ id: 2n }]);
    envState.values = { SCHEDULER_RELEASES_SWEEP_HOURS: 24 };
    await releasesSweep();
    const where = findManyMock.mock.calls[0]![0].where;
    expect(where.fetchStatus).toBe('ok');
    expect(where.releasesFetchedAt).toBeDefined();
    expect(where.releasesFetchedAt.lt).toBeInstanceOf(Date);
    expect(where.lastFetchedAt).toBeUndefined();
    expect(where.branchesFetchedAt).toBeUndefined();
  });

  it('branchesSweep uses branchesFetchedAt as the freshness column', async () => {
    findManyMock.mockResolvedValue([{ id: 3n }]);
    envState.values = { SCHEDULER_BRANCHES_SWEEP_HOURS: 24 };
    await branchesSweep();
    const where = findManyMock.mock.calls[0]![0].where;
    expect(where.fetchStatus).toBe('ok');
    expect(where.branchesFetchedAt).toBeDefined();
    expect(where.branchesFetchedAt.lt).toBeInstanceOf(Date);
    expect(where.lastFetchedAt).toBeUndefined();
    expect(where.releasesFetchedAt).toBeUndefined();
  });

  it('cutoff time = now - cadenceHours * 3600_000', async () => {
    findManyMock.mockResolvedValue([]);
    const now = Date.now();
    envState.values = { SCHEDULER_RELEASES_SWEEP_HOURS: 24 };
    await releasesSweep();
    const where = findManyMock.mock.calls[0]![0].where;
    const cutoff = where.releasesFetchedAt.lt.getTime();
    const expected = now - 24 * 3_600_000;
    expect(Math.abs(cutoff - expected)).toBeLessThan(1_000);
  });

  it('skips createMany when no stale repos are found', async () => {
    findManyMock.mockResolvedValue([]);
    envState.values = { SCHEDULER_CORE_SWEEP_HOURS: 168 };
    const result = await coreSweep();
    expect(result.reposFound).toBe(0);
    expect(result.jobsCreated).toBe(0);
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('creates one job per stale repo with the right kind', async () => {
    findManyMock.mockResolvedValue([{ id: 10n }, { id: 11n }, { id: 12n }]);
    envState.values = { SCHEDULER_BRANCHES_SWEEP_HOURS: 24 };
    createManyMock.mockResolvedValue({ count: 3 });
    const result = await branchesSweep();
    expect(result.reposFound).toBe(3);
    expect(result.jobsCreated).toBe(3);
    expect(createManyMock).toHaveBeenCalledTimes(1);
    const data = createManyMock.mock.calls[0]![0].data;
    expect(data).toHaveLength(3);
    expect(data.every((d: { kind: string }) => d.kind === 'branches')).toBe(true);
    expect(data.every((d: { priority: number }) => d.priority === 99)).toBe(true);
    expect(data.every((d: { scheduledFor: Date }) => d.scheduledFor instanceof Date)).toBe(true);
  });
});
