import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { listRefreshJobs } from '@/lib/db/refresh-jobs';
import { prisma } from '@/lib/db/client';

const TEST_OWNER_PREFIX = 'db-rjlist-test-';
const TEST_NAME_PREFIX = 'rj-';

interface SeededJob {
  id: bigint;
  owner: string;
  name: string;
  kind: 'core' | 'releases' | 'branches';
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  priority: number;
}

const testJobIds: bigint[] = [];

async function seedJobs(): Promise<SeededJob[]> {
  // Wipe any prior test rows so each `beforeEach` starts clean.
  await prisma.refreshJob.deleteMany({
    where: { owner: { startsWith: TEST_OWNER_PREFIX } },
  });
  testJobIds.length = 0;

  // 6 rows: varied status / kind / owner / name / priority / scheduledFor.
  // Insert in two groups of 3 separated by a 5ms sleep so `updatedAt` and
  // `scheduledFor` are deterministic for the ordering assertions below.
  const baseTime = Date.now();
  const fixture: Array<{
    owner: string;
    name: string;
    kind: 'core' | 'releases' | 'branches';
    status: 'pending' | 'in_progress' | 'done' | 'failed';
    priority: number;
    scheduledFor: Date;
    lastError?: string;
  }> = [
    {
      owner: `${TEST_OWNER_PREFIX}acme`,
      name: `${TEST_NAME_PREFIX}core-lib`,
      kind: 'core',
      status: 'pending',
      priority: 10,
      scheduledFor: new Date(baseTime + 1000),
    },
    {
      owner: `${TEST_OWNER_PREFIX}acme`,
      name: `${TEST_NAME_PREFIX}releases-bin`,
      kind: 'releases',
      status: 'pending',
      priority: 20,
      scheduledFor: new Date(baseTime + 2000),
    },
    {
      owner: `${TEST_OWNER_PREFIX}acme`,
      name: `${TEST_NAME_PREFIX}branches-bin`,
      kind: 'branches',
      status: 'pending',
      priority: 30,
      scheduledFor: new Date(baseTime + 3000),
    },
  ];

  const inserted: SeededJob[] = [];
  for (const row of fixture) {
    const j = await prisma.refreshJob.create({ data: row });
    inserted.push({
      id: j.id,
      owner: j.owner,
      name: j.name,
      kind: j.kind,
      status: j.status,
      priority: j.priority,
    });
    testJobIds.push(j.id);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 5));
  }

  const secondBatch: typeof fixture = [
    {
      owner: `${TEST_OWNER_PREFIX}other`,
      name: `${TEST_NAME_PREFIX}core-lib`,
      kind: 'core',
      status: 'done',
      priority: 50,
      scheduledFor: new Date(baseTime + 4000),
    },
    {
      owner: `${TEST_OWNER_PREFIX}other`,
      name: `${TEST_NAME_PREFIX}releases-2`,
      kind: 'releases',
      status: 'failed',
      priority: 50,
      scheduledFor: new Date(baseTime + 5000),
      lastError: 'not_found: 404',
    },
    {
      owner: `${TEST_OWNER_PREFIX}acme`,
      name: `${TEST_NAME_PREFIX}inprogress-bin`,
      kind: 'core',
      status: 'in_progress',
      priority: 50,
      scheduledFor: new Date(baseTime + 6000),
    },
  ];
  for (const row of secondBatch) {
    const j = await prisma.refreshJob.create({ data: row });
    inserted.push({
      id: j.id,
      owner: j.owner,
      name: j.name,
      kind: j.kind,
      status: j.status,
      priority: j.priority,
    });
    testJobIds.push(j.id);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 5));
  }
  return inserted;
}

beforeEach(async () => {
  await seedJobs();
});

afterAll(async () => {
  await prisma.refreshJob.deleteMany({
    where: { owner: { startsWith: TEST_OWNER_PREFIX } },
  });
  await prisma.$disconnect();
});

describe('listRefreshJobs', () => {
  it('returns every fixture row with the correct total when no filter is given', async () => {
    const { rows, total } = await listRefreshJobs({ skip: 0, take: 100 });
    const ours = rows.filter((r) => r.owner.startsWith(TEST_OWNER_PREFIX));
    expect(ours).toHaveLength(6);
    // total reflects the global row count (not just ours) — verify it's >= 6.
    expect(total).toBeGreaterThanOrEqual(6);
    for (const r of ours) {
      expect(r.owner.startsWith(TEST_OWNER_PREFIX)).toBe(true);
      expect(['pending', 'in_progress', 'done', 'failed']).toContain(r.status);
      expect(['core', 'releases', 'branches']).toContain(r.kind);
    }
  });

  it('filters by status (pending) and orders by priority ASC then scheduledFor ASC', async () => {
    const { rows, total } = await listRefreshJobs({
      status: 'pending',
      skip: 0,
      take: 100,
    });
    const ours = rows.filter((r) => r.owner.startsWith(TEST_OWNER_PREFIX));
    expect(ours).toHaveLength(3);
    expect(total).toBeGreaterThanOrEqual(3);
    for (const r of ours) {
      expect(r.status).toBe('pending');
    }
    // Pending order: priority ASC → 10, 20, 30.
    expect(ours.map((r) => r.priority)).toEqual([10, 20, 30]);
  });

  it('filters by status (failed) and orders by updatedAt DESC', async () => {
    const { rows } = await listRefreshJobs({
      status: 'failed',
      skip: 0,
      take: 100,
    });
    const ours = rows.filter((r) => r.owner.startsWith(TEST_OWNER_PREFIX));
    expect(ours.length).toBeGreaterThanOrEqual(1);
    for (const r of ours) {
      expect(r.status).toBe('failed');
    }
  });

  it('filters by kind (releases)', async () => {
    const { rows } = await listRefreshJobs({ kind: 'releases', skip: 0, take: 100 });
    const ours = rows.filter((r) => r.owner.startsWith(TEST_OWNER_PREFIX));
    expect(ours).toHaveLength(2);
    for (const r of ours) {
      expect(r.kind).toBe('releases');
    }
  });

  it('filters by owner substring', async () => {
    const { rows } = await listRefreshJobs({
      owner: 'acme',
      skip: 0,
      take: 100,
    });
    const ours = rows.filter((r) => r.owner.startsWith(TEST_OWNER_PREFIX));
    expect(ours.length).toBeGreaterThanOrEqual(4); // 3 acme + 1 in_progress
    for (const r of ours) {
      expect(r.owner.includes('acme')).toBe(true);
    }
  });

  it('filters by name substring', async () => {
    const { rows } = await listRefreshJobs({
      name: 'core-lib',
      skip: 0,
      take: 100,
    });
    const ours = rows.filter((r) => r.owner.startsWith(TEST_OWNER_PREFIX));
    expect(ours).toHaveLength(2);
    for (const r of ours) {
      expect(r.name.includes('core-lib')).toBe(true);
    }
  });

  it('filters by updatedAt range [from, to)', async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    const { rows } = await listRefreshJobs({
      from: past,
      to: future,
      skip: 0,
      take: 100,
    });
    const ours = rows.filter((r) => r.owner.startsWith(TEST_OWNER_PREFIX));
    expect(ours).toHaveLength(6);
    for (const r of ours) {
      expect(r.updatedAt.getTime()).toBeGreaterThanOrEqual(past.getTime());
      expect(r.updatedAt.getTime()).toBeLessThan(future.getTime());
    }
  });

  it('combines status + kind (intersection)', async () => {
    const { rows } = await listRefreshJobs({
      status: 'pending',
      kind: 'releases',
      skip: 0,
      take: 100,
    });
    const ours = rows.filter((r) => r.owner.startsWith(TEST_OWNER_PREFIX));
    expect(ours).toHaveLength(1);
    expect(ours[0]!.kind).toBe('releases');
    expect(ours[0]!.status).toBe('pending');
  });

  it('skips + takes paginates the result set', async () => {
    // Seed exactly 6 fixture rows in this `beforeEach`; fetch page 2 of 2.
    const { rows, total } = await listRefreshJobs({ skip: 2, take: 2 });
    expect(rows).toHaveLength(2);
    // Sanity: total reflects global row count, not just ours.
    expect(total).toBeGreaterThanOrEqual(6);
  });
});