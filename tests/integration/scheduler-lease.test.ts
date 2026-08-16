import { describe, it, expect, beforeEach, afterAll, afterEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import { claimBatch } from '@/lib/scheduler/lease';
import type { RefreshJob, Repository } from '@prisma/client';

const TEST_OWNER = 'scheduler-lease-test';

describe('claimBatch', () => {
  let repo: Repository;

  beforeEach(async () => {
    // Clean any leftover data from previous runs
    await prisma.refreshJob.deleteMany({ where: { repository: { owner: TEST_OWNER } } });
    await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });

    // Create a parent Repository (required by the FK from RefreshJob)
    repo = await prisma.repository.create({
      data: {
        owner: TEST_OWNER,
        name: 'lease-test',
        node: { id: 99_999_999 },
        fetchStatus: 'ok',
      },
    });
  });

  afterEach(async () => {
    await prisma.refreshJob.deleteMany({ where: { repository: { owner: TEST_OWNER } } });
    await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeJob(overrides: Partial<{
    priority: number;
    scheduledFor: Date;
    status: 'pending' | 'in_progress' | 'done' | 'failed';
    lockedUntil: Date | null;
    attempts: number;
  }> = {}): Promise<RefreshJob> {
    return prisma.refreshJob.create({
      data: {
        repositoryId: repo.id,
        priority: 50,
        scheduledFor: new Date(),
        status: 'pending',
        attempts: 0,
        ...overrides,
      },
    });
  }

  it('returns [] when queue is empty', async () => {
    const jobs = await claimBatch(10);
    expect(jobs.filter((j) => j.repositoryId === repo.id)).toEqual([]);
  });

  it('claims a single pending job', async () => {
    const j = await makeJob();
    const claimed = (await claimBatch(10)).filter((c) => c.repositoryId === repo.id);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id).toBe(j.id);
    expect(claimed[0]!.repository.id).toBe(repo.id);
  });

  it('marks claimed job with status=in_progress, lockedUntil, attempts++', async () => {
    await makeJob({ attempts: 2 });
    const claimed = (await claimBatch(10)).filter((c) => c.repositoryId === repo.id);
    expect(claimed[0]!.status).toBe('in_progress');
    expect(claimed[0]!.attempts).toBe(3); // incremented from 2
    expect(claimed[0]!.lockedUntil).not.toBeNull();
    expect(claimed[0]!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(claimed[0]!.lockedUntil!.getTime()).toBeLessThanOrEqual(
      Date.now() + 5 * 60_000 + 1000,
    );
  });

  it('does not claim jobs scheduled in the future', async () => {
    await makeJob({ scheduledFor: new Date(Date.now() + 60_000) });
    const claimed = (await claimBatch(10)).filter((c) => c.repositoryId === repo.id);
    expect(claimed).toEqual([]);
  });

  it('does not claim in_progress jobs', async () => {
    await makeJob({ status: 'in_progress' });
    const claimed = (await claimBatch(10)).filter((c) => c.repositoryId === repo.id);
    expect(claimed).toEqual([]);
  });

  it('does not claim done jobs', async () => {
    await makeJob({ status: 'done' });
    const claimed = (await claimBatch(10)).filter((c) => c.repositoryId === repo.id);
    expect(claimed).toEqual([]);
  });

  it('does not claim jobs locked by another worker (lockedUntil in future)', async () => {
    await makeJob({ lockedUntil: new Date(Date.now() + 60_000) });
    const claimed = (await claimBatch(10)).filter((c) => c.repositoryId === repo.id);
    expect(claimed).toEqual([]);
  });

  it('claims jobs whose lease has expired (lockedUntil in past)', async () => {
    const j = await makeJob({ lockedUntil: new Date(Date.now() - 1000) });
    const claimed = (await claimBatch(10)).filter((c) => c.repositoryId === repo.id);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id).toBe(j.id);
  });

  it('respects batchSize limit', async () => {
    await makeJob();
    await makeJob();
    await makeJob();
    const claimed = (await claimBatch(2)).filter((c) => c.repositoryId === repo.id);
    expect(claimed).toHaveLength(2);
  });

  it('orders by priority ASC then scheduled_for ASC', async () => {
    // Opposing keys: priority ASC and scheduledFor DESC would conflict.
    // Use a setup where priority determines order, NOT time.
    const low = await makeJob({ priority: 10, scheduledFor: new Date(Date.now() - 1_000) });   // -1s
    const med = await makeJob({ priority: 50, scheduledFor: new Date(Date.now() - 30_000) });  // -30s
    const high = await makeJob({ priority: 90, scheduledFor: new Date(Date.now() - 60_000) }); // -60s
    // Expected: [low, med, high] — by priority ASC; time DESC would give [high, med, low]
    const claimed = await claimBatch(10);
    expect(claimed.filter((j) => j.repositoryId === repo.id).map((j) => j.id)).toEqual([
      low.id,
      med.id,
      high.id,
    ]);
  });

  it('uses scheduledFor ASC as tiebreak among same priority', async () => {
    // Same priority (50); earlier scheduledFor should come first.
    const sameA = await makeJob({ priority: 50, scheduledFor: new Date(Date.now() - 5_000) });
    const sameB = await makeJob({ priority: 50, scheduledFor: new Date(Date.now() - 10_000) });
    const claimed = await claimBatch(10);
    const ours = claimed.filter((j) => j.repositoryId === repo.id);
    expect(ours.map((j) => j.id)).toEqual([sameB.id, sameA.id]);
  });

  it('sequential claims do not overlap', async () => {
    // With FOR UPDATE (no SKIP LOCKED), concurrent claims on MySQL 5.7 will block.
    // Single-worker safe: subsequent claims see the previous batch's status=in_progress.
    await makeJob();
    await makeJob();
    await makeJob();
    await makeJob();

    const a = (await claimBatch(2)).filter((c) => c.repositoryId === repo.id);
    const b = (await claimBatch(2)).filter((c) => c.repositoryId === repo.id);
    const allClaimed = [...a, ...b];
    expect(allClaimed).toHaveLength(4);
    const ids = new Set(allClaimed.map((j) => j.id as unknown as number));
    expect(ids.size).toBe(4); // all 4 distinct
  });

  it('returns repository via include', async () => {
    await makeJob();
    const claimed = (await claimBatch(1)).filter((c) => c.repositoryId === repo.id);
    expect(claimed[0]!.repository.owner).toBe(TEST_OWNER);
    expect(claimed[0]!.repository.name).toBe('lease-test');
  });
});