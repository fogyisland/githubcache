import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '@/lib/db/client';
import {
  previewProvider,
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
  await prisma.ingestionProvider.create({
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