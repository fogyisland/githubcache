import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { listRepositories } from '@/lib/db/repositories';

/**
 * M31 — `listRepositories` only returns `fetchStatus='ok'` rows.
 *
 * Post-M31 the `repositories` table is populated exclusively by
 * GitHub 200/304 responses via `storeRepoMetadata`'s new create path
 * — `refreshOne` failure branches (404/410/403) no longer write to
 * `repositories`. The admin "imported nodes" page (/admin/repositories)
 * should therefore only show 'ok' rows.
 *
 * This test seeds three rows directly via prisma.repository.create
 * with mixed fetchStatus values and verifies that:
 *
 *   1. Calling `listRepositories({ fetchStatus: 'ok', ... })` returns
 *      only the 'ok' row (filter works).
 *   2. The non-ok rows (not_found, forbidden) are excluded by the
 *      filter — proves the WHERE clause correctly drops them.
 *   3. When no fetchStatus is supplied, callers must filter explicitly.
 *      M31 invariant: no failure path creates non-ok rows, so the
 *      admin page's "every row is ok" comment holds in practice.
 *
 * All assertions are scoped to TEST_OWNER to avoid coupling to other
 * tests' fixtures that share the `repositories` table.
 */

const TEST_OWNER = 'admin-repositories-only-ok-test';

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.repository.deleteMany({ where: { owner: TEST_OWNER } });
});

describe('listRepositories (M31 — only fetchStatus=ok)', () => {
  it('filters to fetchStatus=ok when the caller asks for it explicitly', async () => {
    // Seed: one ok, one not_found, one forbidden.
    await prisma.repository.create({
      data: {
        owner: TEST_OWNER,
        name: 'a-ok',
        node: { id: 1 },
        metadata: { stars: 10 },
        fetchStatus: 'ok',
      },
    });
    await prisma.repository.create({
      data: {
        owner: TEST_OWNER,
        name: 'b-not-found',
        node: { id: 2 },
        metadata: Prisma.JsonNull,
        fetchStatus: 'not_found',
      },
    });
    await prisma.repository.create({
      data: {
        owner: TEST_OWNER,
        name: 'c-forbidden',
        node: { id: 3 },
        metadata: Prisma.JsonNull,
        fetchStatus: 'forbidden',
      },
    });

    // Explicit filter — proves the WHERE clause filter works.
    const { rows } = await listRepositories({
      fetchStatus: 'ok',
      skip: 0,
      take: 50,
    });
    // Scope to our owner so unrelated rows from other tests don't
    // affect the assertion.
    const ours = rows.filter((r) => r.owner === TEST_OWNER);
    expect(ours).toHaveLength(1);
    expect(ours[0]?.name).toBe('a-ok');
    expect(ours[0]?.fetchStatus).toBe('ok');
  });

  it('excludes non-ok rows (not_found, forbidden) from the ok filter', async () => {
    await prisma.repository.create({
      data: {
        owner: TEST_OWNER,
        name: 'b-not-found',
        node: { id: 2 },
        metadata: Prisma.JsonNull,
        fetchStatus: 'not_found',
      },
    });
    await prisma.repository.create({
      data: {
        owner: TEST_OWNER,
        name: 'c-forbidden',
        node: { id: 3 },
        metadata: Prisma.JsonNull,
        fetchStatus: 'forbidden',
      },
    });

    const { rows } = await listRepositories({
      fetchStatus: 'ok',
      skip: 0,
      take: 50,
    });
    // Both non-ok rows must be excluded — neither name appears in the
    // ok-filtered result.
    const ours = rows.filter((r) => r.owner === TEST_OWNER);
    expect(ours).toHaveLength(0);
  });

  it('returns rows across all statuses when fetchStatus is omitted', async () => {
    // The current listRepositories implementation only filters when
    // fetchStatus is supplied; no-filter returns everything. M31 makes
    // this safe by ensuring only-ok rows are ever written. This test
    // locks in that contract: caller-side filtering is still required.
    await prisma.repository.create({
      data: {
        owner: TEST_OWNER,
        name: 'a-ok',
        node: { id: 1 },
        metadata: { stars: 10 },
        fetchStatus: 'ok',
      },
    });
    await prisma.repository.create({
      data: {
        owner: TEST_OWNER,
        name: 'b-not-found',
        node: { id: 2 },
        metadata: Prisma.JsonNull,
        fetchStatus: 'not_found',
      },
    });

    const { rows } = await listRepositories({
      skip: 0,
      take: 50,
    });
    // Filter to our owner — verifies that without an explicit
    // fetchStatus filter, ALL our seeded rows come back (ok AND
    // not_found). This is the behaviour the M31 invariant relies on:
    // writes don't create non-ok rows, so callers don't need to
    // filter at the read layer.
    const ours = rows.filter((r) => r.owner === TEST_OWNER);
    expect(ours).toHaveLength(2);
    const names = ours.map((r) => r.name).sort();
    expect(names).toEqual(['a-ok', 'b-not-found']);
  });
});
