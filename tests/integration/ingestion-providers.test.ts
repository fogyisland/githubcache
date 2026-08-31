import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '@/lib/db/client';
import {
  previewProvider,
  runProvider,
  ProviderNotFoundError,
  ProviderDisabledError,
} from '@/lib/ingestion/providers/run';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_OWNER_PREFIX = 'm19-fixture';
const TEST_SLUG = 'm19-test-provider';

const FIXTURE_PATH = path
  .resolve(__dirname, '..', 'fixtures', 'comfyui-nodes.json')
  .replace(/\\/g, '/');

const FIXTURE_ROOT = path.resolve(__dirname, '..', 'fixtures');

const testRepoIds: bigint[] = [];
const testJobIds: bigint[] = [];

async function cleanup(): Promise<void> {
  if (testJobIds.length > 0) {
    await prisma.refreshJob.deleteMany({
      where: { id: { in: testJobIds } },
    });
    testJobIds.length = 0;
  }
  if (testRepoIds.length > 0) {
    await prisma.repository.deleteMany({
      where: { id: { in: testRepoIds } },
    });
    testRepoIds.length = 0;
  }
}

beforeAll(async () => {
  // Allow reading the fixture file via PROVIDER_FILE_ROOTS.
  process.env.PROVIDER_FILE_ROOTS = FIXTURE_ROOT;
});

afterAll(async () => {
  await cleanup();
  // Best-effort cleanup of any provider we created.
  await prisma.ingestionProvider.deleteMany({
    where: { slug: { startsWith: 'm19-' } },
  });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanup();
  await prisma.ingestionProvider.deleteMany({
    where: { slug: { startsWith: 'm19-' } },
  });
  const provider = await prisma.ingestionProvider.create({
    data: {
      slug: TEST_SLUG,
      name: 'M19 test provider',
      sourceType: 'json',
      configJson: {
        kind: 'file',
        path: FIXTURE_PATH,
        itemsPath: '$.custom_nodes',
        urlField: 'files[0]',
      },
      enabled: true,
    },
  });
});

describe('previewProvider', () => {
  it('returns counts with mix of new/stale/existing', async () => {
    // Seed 2 repos:
    //   - Fixture-A as ok + lastFetched → existing
    //   - Fixture-B as error → stale
    const a = await prisma.repository.create({
      data: {
        owner: TEST_OWNER_PREFIX,
        name: 'Fixture-A',
        node: { stub: true } as never,
        fetchStatus: 'ok',
        lastFetchedAt: new Date(),
      },
    });
    testRepoIds.push(a.id);
    const b = await prisma.repository.create({
      data: {
        owner: TEST_OWNER_PREFIX,
        name: 'Fixture-B',
        node: { stub: true } as never,
        fetchStatus: 'error',
        lastFetchedAt: null,
      },
    });
    testRepoIds.push(b.id);

    const result = await previewProvider(TEST_SLUG);

    // Fixture has 5 items. urls: 5 (one per file[0]). unique after
    // dedupe (Fixture-A appears twice): 4. invalid: 0.
    expect(result.totals.items).toBe(5);
    expect(result.totals.urls).toBe(5);
    expect(result.totals.unique).toBe(4);
    expect(result.totals.invalid).toBe(1);
    expect(result.totals.existing).toBe(1);
    expect(result.totals.stale).toBe(1);
    expect(result.totals.new).toBe(2);

    // Sample should not include the existing one.
    const sampleKeys = result.sample.map((s) => `${s.owner}/${s.name}`);
    expect(sampleKeys).not.toContain(`${TEST_OWNER_PREFIX}/Fixture-A`);
    expect(sampleKeys).toContain(`${TEST_OWNER_PREFIX}/Fixture-B`);
    expect(sampleKeys.length).toBeLessThanOrEqual(20);
  });

  it('throws ProviderNotFoundError for unknown slug', async () => {
    await expect(previewProvider('does-not-exist')).rejects.toBeInstanceOf(
      ProviderNotFoundError,
    );
  });

  it('throws ProviderDisabledError for disabled provider', async () => {
    await prisma.ingestionProvider.update({
      where: { slug: TEST_SLUG },
      data: { enabled: false },
    });
    await expect(previewProvider(TEST_SLUG)).rejects.toBeInstanceOf(
      ProviderDisabledError,
    );
  });
});

describe('runProvider', () => {
  it('dryRun=true does not create any refresh_jobs', async () => {
    const a = await prisma.repository.create({
      data: {
        owner: TEST_OWNER_PREFIX,
        name: 'Fixture-A',
        node: { stub: true } as never,
        fetchStatus: 'ok',
        lastFetchedAt: new Date(),
      },
    });
    testRepoIds.push(a.id);

    const result = await runProvider(TEST_SLUG, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.jobCount).toBe(0);
    expect(result.totals.unique).toBe(4);
    expect(result.totals.existing).toBe(1);
    expect(result.totals.stale).toBe(0);
    expect(result.totals.new).toBe(3);

    const jobs = await prisma.refreshJob.findMany({
      where: { repositoryId: { in: testRepoIds } },
    });
    expect(jobs.length).toBe(0);
  });

  it('creates refresh_jobs for new and stale pairs, leaves existing untouched', async () => {
    // existing: ok + fetched
    const a = await prisma.repository.create({
      data: {
        owner: TEST_OWNER_PREFIX,
        name: 'Fixture-A',
        node: { stub: true } as never,
        fetchStatus: 'ok',
        lastFetchedAt: new Date(),
      },
    });
    testRepoIds.push(a.id);
    // stale: error
    const b = await prisma.repository.create({
      data: {
        owner: TEST_OWNER_PREFIX,
        name: 'Fixture-B',
        node: { stub: true } as never,
        fetchStatus: 'error',
        lastFetchedAt: null,
      },
    });
    testRepoIds.push(b.id);

    const result = await runProvider(TEST_SLUG);

    expect(result.dryRun).toBe(false);
    // stale=1 + new=2 (C, D) = 3 jobs.
    expect(result.jobCount).toBe(3);
    expect(result.totals.existing).toBe(1);

    // Verify all 3 jobs were created (existing A was NOT re-enqueued).
    const jobs = await prisma.refreshJob.findMany({
      where: { repository: { owner: TEST_OWNER_PREFIX } },
    });
    testJobIds.push(...jobs.map((j) => j.id));
    expect(jobs.length).toBe(3);

    // Verify no job points at A (existing_ok).
    const aJobs = jobs.filter((j) => j.repositoryId === a.id);
    expect(aJobs.length).toBe(0);

    // Verify one job points at B (stale).
    const bJobs = jobs.filter((j) => j.repositoryId === b.id);
    expect(bJobs.length).toBe(1);

    // Verify C and D rows were upserted with fetchStatus='ok' (the
    // stub default) and got a job each.
    const cOrD = await prisma.repository.findMany({
      where: {
        owner: TEST_OWNER_PREFIX,
        name: { in: ['Fixture-C', 'Fixture-D'] },
      },
    });
    expect(cOrD.length).toBe(2);
    for (const r of cOrD) {
      testRepoIds.push(r.id);
      const rJobs = jobs.filter((j) => j.repositoryId === r.id);
      expect(rJobs.length).toBe(1);
    }
  });

  it('throws ProviderNotFoundError for unknown slug', async () => {
    await expect(runProvider('does-not-exist')).rejects.toBeInstanceOf(
      ProviderNotFoundError,
    );
  });
});