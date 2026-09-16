import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import { lookupRepo } from '@/lib/cache/lookup';

/**
 * M32.7.9 — `lookupRepo` short-circuits on a `refresh_jobs` negative
 * cache row left by `refreshOne.handleError` after a 404/410.
 *
 * contract:
 *   - refresh_jobs row with status='failed' AND lastError startsWith
 *     'not_found:' is the negative-cache marker.
 *   - lookupRepo on such a (owner, name) returns fetch_status='not_found'
 *     WITHOUT calling enqueueRefresh (no pending job created).
 *
 * Why this matters: a fresh public-form submit for a repo that was
 * already 404'd in the past used to re-enqueue forever (the cache miss
 * kept hitting GitHub). Now it returns the same not_found shape
 * immediately. The scheduler's claimBatch only picks up status='pending',
 * so the negative cache row never re-runs unless an admin manually
 * re-enqueues.
 */
const TEST_OWNER = 'lookup-not-found-cache-test';
const NEGATIVE_CACHE_MARKER = 'not_found: 404 Not Found';

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.refreshJob.deleteMany({ where: { owner: TEST_OWNER } });
  await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.refreshJob.deleteMany({ where: { owner: TEST_OWNER } });
  await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });
});

describe('lookupRepo negative cache (M32.7.9)', () => {
  it('returns fetch_status=not_found without enqueueing when a failed not_found refresh_job exists', async () => {
    // Pre-plant the negative-cache marker — simulates what
    // refreshOne.handleError writes after a 404.
    await prisma.refreshJob.create({
      data: {
        owner: TEST_OWNER,
        name: 'gone-repo',
        repositoryId: null,
        priority: 0,
        scheduledFor: new Date(Date.now() + 365 * 24 * 60 * 60_000),
        status: 'failed',
        attempts: 1,
        lastError: NEGATIVE_CACHE_MARKER,
        lockedUntil: null,
      },
    });

    const result = await lookupRepo(TEST_OWNER, 'gone-repo');

    // M32.7.9 — terminal not_found, no pending.
    expect(result.fetch_status).toBe('not_found');
    expect(result.found).toBe(false);
    // Same user-facing message as the in-row fetchStatus='not_found'
    // path, so callers don't have to special-case either shape.
    if (result.fetch_status === 'not_found') {
      expect(result.error).toBe('Repository not found or private');
    }

    // CRITICAL: no pending refresh_job was created. Without the negative
    // cache check, lookupRepo would call enqueueRefresh and create one —
    // the scheduler would then fetch GitHub again forever, hitting the
    // same 404 every time.
    const pendingJobs = await prisma.refreshJob.findMany({
      where: {
        owner: TEST_OWNER,
        name: 'gone-repo',
        status: 'pending',
      },
    });
    expect(pendingJobs).toHaveLength(0);

    // And no Repository row was created either.
    const repoCount = await prisma.repository.count({
      where: { owner: TEST_OWNER, name: 'gone-repo' },
    });
    expect(repoCount).toBe(0);
  });

  it('does NOT short-circuit on a failed refresh_job whose lastError is NOT not_found (e.g. 403)', async () => {
    // 403 / network-error negative terminals — refreshOne.handleError
    // writes status='failed' but lastError does NOT start with
    // 'not_found:'. lookupRepo must NOT treat them as a negative cache;
    // it should fall through to enqueueRefresh so the scheduler retries.
    await prisma.refreshJob.create({
      data: {
        owner: TEST_OWNER,
        name: 'forbidden-repo',
        repositoryId: null,
        priority: 0,
        scheduledFor: new Date(),
        status: 'failed',
        attempts: 1,
        lastError: 'API rate limit exceeded',
        lockedUntil: null,
      },
    });

    const result = await lookupRepo(TEST_OWNER, 'forbidden-repo');

    // A pending refresh_job was enqueued — the 403 failure isn't
    // permanent (admin can re-grant access), so we keep trying.
    expect(result.fetch_status).toBe('pending');

    const jobs = await prisma.refreshJob.findMany({
      where: { owner: TEST_OWNER, name: 'forbidden-repo' },
    });
    expect(jobs.some((j) => j.status === 'pending')).toBe(true);
  });

  it('cold-cache miss on a fresh (owner, name) still enqueues — no false negative cache hit', async () => {
    // No row of any kind in either table for this owner/name.
    const result = await lookupRepo(TEST_OWNER, 'fresh-repo');

    expect(result.fetch_status).toBe('pending');

    const jobs = await prisma.refreshJob.findMany({
      where: { owner: TEST_OWNER, name: 'fresh-repo' },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('pending');
  });
});