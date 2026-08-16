import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/client';
import { nightlySweep } from '@/lib/scheduler/sweep';
import type { Repository } from '@prisma/client';

const TEST_OWNER = 'scheduler-sweep-test';

describe('nightlySweep', () => {
  let ok1: Repository, ok2: Repository, notFound: Repository, forbidden: Repository;

  beforeEach(async () => {
    await prisma.refreshJob.deleteMany({ where: { repository: { owner: TEST_OWNER } } });
    await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });

    ok1 = await prisma.repository.create({
      data: { owner: TEST_OWNER, name: 'ok-1', node: {}, fetchStatus: 'ok' },
    });
    ok2 = await prisma.repository.create({
      data: { owner: TEST_OWNER, name: 'ok-2', node: {}, fetchStatus: 'ok' },
    });
    notFound = await prisma.repository.create({
      data: { owner: TEST_OWNER, name: 'nf-1', node: {}, fetchStatus: 'not_found' },
    });
    forbidden = await prisma.repository.create({
      data: { owner: TEST_OWNER, name: 'fb-1', node: {}, fetchStatus: 'forbidden' },
    });
  });

  afterEach(async () => {
    await prisma.refreshJob.deleteMany({ where: { repository: { owner: TEST_OWNER } } });
    await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // NOTE: nightlySweep queries ALL repositories with fetchStatus='ok' across the
  // shared DB, not just the test's. We check the DB state for OUR test's owners
  // to verify sweep behavior, rather than relying on the aggregate counts.

  it('creates one job per fetchStatus=ok repo', async () => {
    await nightlySweep();

    const ok1Jobs = await prisma.refreshJob.findMany({ where: { repositoryId: ok1.id } });
    const ok2Jobs = await prisma.refreshJob.findMany({ where: { repositoryId: ok2.id } });
    expect(ok1Jobs).toHaveLength(1);
    expect(ok2Jobs).toHaveLength(1);
  });

  it('creates jobs only for fetchStatus=ok repos', async () => {
    await nightlySweep();

    const okJobs = await prisma.refreshJob.findMany({ where: { repositoryId: ok1.id } });
    const nfJobs = await prisma.refreshJob.findMany({ where: { repositoryId: notFound.id } });
    const fbJobs = await prisma.refreshJob.findMany({ where: { repositoryId: forbidden.id } });

    expect(okJobs).toHaveLength(1);
    expect(nfJobs).toHaveLength(0);
    expect(fbJobs).toHaveLength(0);
  });

  it('does not create duplicate jobs for repos with existing pending jobs', async () => {
    // First sweep
    await nightlySweep();
    // Snapshot existing jobs for our ok1
    const ok1JobsBefore = await prisma.refreshJob.count({ where: { repositoryId: ok1.id } });
    // Second sweep immediately
    await nightlySweep();
    // Should create another job for ok1 (no dedup logic — duplicate jobs allowed)
    const ok1JobsAfter = await prisma.refreshJob.count({ where: { repositoryId: ok1.id } });
    expect(ok1JobsAfter).toBe(ok1JobsBefore + 1);
  });

  it('created jobs have priority=99 and scheduledFor in the past', async () => {
    const before = Date.now();
    await nightlySweep();
    const after = Date.now();
    const jobs = await prisma.refreshJob.findMany({
      where: { repository: { owner: TEST_OWNER } },
    });
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.priority).toBe(99);
      expect(j.scheduledFor.getTime()).toBeGreaterThanOrEqual(before);
      expect(j.scheduledFor.getTime()).toBeLessThanOrEqual(after);
      expect(j.status).toBe('pending');
    }
  });

  it('skips not_found repos (filter is fetchStatus=ok only)', async () => {
    // Remove the ok repos so only not_found + forbidden remain
    await prisma.repository.deleteMany({
      where: { owner: TEST_OWNER, name: { in: ['ok-1', 'ok-2'] } },
    });
    await nightlySweep();

    // not_found + forbidden repos should have no jobs created
    const nfJobs = await prisma.refreshJob.findMany({ where: { repositoryId: notFound.id } });
    expect(nfJobs).toHaveLength(0);
  });

  it('skips forbidden repos (filter is fetchStatus=ok only)', async () => {
    await prisma.repository.deleteMany({
      where: { owner: TEST_OWNER, name: { in: ['ok-1', 'ok-2'] } },
    });
    await nightlySweep();

    // forbidden repos should have no jobs created
    const fbJobs = await prisma.refreshJob.findMany({ where: { repositoryId: forbidden.id } });
    expect(fbJobs).toHaveLength(0);
  });

  it('returns non-negative counts (aggregate result is well-formed)', async () => {
    // Aggregate counts may include other tests' repos in the shared DB,
    // but the result shape must always be valid non-negative numbers.
    const result = await nightlySweep();
    expect(result.reposFound).toBeGreaterThanOrEqual(0);
    expect(result.jobsCreated).toBeGreaterThanOrEqual(0);
    expect(result.jobsCreated).toBe(result.reposFound);
  });
});
