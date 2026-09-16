import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import { storeRepoMetadata, getRepoMetadata } from '@/lib/cache';

describe('cache write+read round-trip', () => {
  afterAll(async () => {
    // M31 — RefreshJob no longer has a `repository` relation; owner/name
    // live on the row directly. The relation-based cleanup shape below
    // was deleted along with the FK in M31.
    await prisma.refreshJob.deleteMany({ where: { owner: 'test-owner' } });
    await prisma.repository.deleteMany({ where: { owner: 'test-owner' } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.refreshJob.deleteMany({ where: { owner: 'test-owner' } });
    await prisma.repository.deleteMany({ where: { owner: 'test-owner' } });
  });

  it('upserts then reads back via getRepoMetadata', async () => {
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'test-repo',
      node: { id: 1, name: 'test-repo' },
      metadata: { stars: 42 },
      fetchStatus: 'ok',
    });
    const r = await getRepoMetadata('test-owner', 'test-repo');
    expect(r.found).toBe(true);
    if (r.found && r.fetchStatus !== 'not_found') {
      expect(r.metadata).toEqual({ stars: 42 });
    }
  });

  it('upsert updates existing row without creating duplicate', async () => {
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'test-repo-2',
      node: { id: 1 },
      metadata: { stars: 1 },
      fetchStatus: 'ok',
    });
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'test-repo-2',
      node: { id: 1 },
      metadata: { stars: 2 },
      fetchStatus: 'ok',
    });
    const all = await prisma.repository.findMany({
      where: { owner: 'test-owner', name: 'test-repo-2' },
    });
    expect(all).toHaveLength(1);
  });

  it('storeRepoMetadata with fetchStatus=not_found yields metadata=null on read', async () => {
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'gone',
      node: { id: 1 },
      metadata: null,
      fetchStatus: 'not_found',
    });
    const r = await getRepoMetadata('test-owner', 'gone');
    expect(r.found).toBe(true);
    if (r.found && r.fetchStatus === 'not_found') {
      expect(r.metadata).toBeNull();
    }
  });
});

describe('create-then-update (M31 split)', () => {
  // M31 — storeRepoMetadata now goes through findRepoByCanonical →
  // updateRepo on the second call instead of the original
  // prisma.repository.upsert. This block guards against regressions
  // where the update path accidentally creates a duplicate row
  // (e.g., if the new code path forgets the owner_name unique check)
  // or strips the second call's metadata on the way back into the
  // row.

  afterEach(async () => {
    await prisma.refreshJob.deleteMany({ where: { owner: 'test-owner' } });
    await prisma.repository.deleteMany({ where: { owner: 'test-owner' } });
  });

  it('two consecutive storeRepoMetadata calls yield exactly ONE row (no duplicate)', async () => {
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'split-test',
      node: { id: 100 },
      metadata: { stars: 1 },
      fetchStatus: 'ok',
    });
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'split-test',
      node: { id: 100 },
      metadata: { stars: 2 },
      fetchStatus: 'ok',
    });

    const all = await prisma.repository.findMany({
      where: { owner: 'test-owner', name: 'split-test' },
    });
    // M31 split: first call → createRepo; second call → updateRepo.
    // Must result in EXACTLY ONE row (the @@unique([owner, name])
    // constraint enforces this anyway, but the test guards against
    // the case where the new code path's updateRepo accidentally
    // blows up before the WHERE clause runs).
    expect(all).toHaveLength(1);
  });

  it('second call updates the row (metadata reflects the second call)', async () => {
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'split-test-2',
      node: { id: 200 },
      metadata: { stars: 50, forks: 5 },
      fetchStatus: 'ok',
    });
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'split-test-2',
      node: { id: 200 },
      metadata: { stars: 99, forks: 7 },
      fetchStatus: 'ok',
    });

    const row = await prisma.repository.findUnique({
      where: { owner_name: { owner: 'test-owner', name: 'split-test-2' } },
    });
    expect(row).not.toBeNull();
    // Second-call values must win — storeRepoMetadata spreads the
    // full baseData into updateRepo, not a partial set. M27.4 fixed
    // exactly this regression; this test guards the create-vs-update
    // split against re-introducing it.
    expect(row?.stars).toBe(99);
    expect(row?.forks).toBe(7);
  });

  it('second call with fetchStatus=not_found updates status without creating a new row', async () => {
    // First call: row exists, ok.
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'split-test-3',
      node: { id: 300 },
      metadata: { stars: 10 },
      fetchStatus: 'ok',
    });
    // Second call: same row, status flips to not_found.
    await storeRepoMetadata({
      owner: 'test-owner',
      name: 'split-test-3',
      node: { id: 300 },
      metadata: null,
      fetchStatus: 'not_found',
    });

    const all = await prisma.repository.findMany({
      where: { owner: 'test-owner', name: 'split-test-3' },
    });
    expect(all).toHaveLength(1);
    expect(all[0]?.fetchStatus).toBe('not_found');
  });

  it('concurrent calls on a cold cache yield exactly ONE row (M31.1 P2002 guard)', async () => {
    // M31.1 — the findRepoByCanonical + createRepo path in
    // storeRepoMetadata is racy: two workers calling
    // storeRepoMetadata(owner, name) concurrently each observe
    // "no existing row" and both attempt createRepo. The second
    // INSERT hits the @@unique([owner, name]) constraint and throws
    // P2002. Without the catch in storeRepoMetadata, P2002 escalates
    // all the way to refresh-one.handleError and marks the
    // refresh_job failed — but the first worker's row is correct.
    //
    // After the fix: the second caller catches P2002, re-reads the
    // row the first worker wrote, and falls through to updateRepo.
    // Both calls resolve successfully and the row count stays at 1.
    const results = await Promise.allSettled([
      storeRepoMetadata({
        owner: 'test-owner',
        name: 'race-test',
        node: { id: 999 },
        metadata: { stars: 1 },
        fetchStatus: 'ok',
      }),
      storeRepoMetadata({
        owner: 'test-owner',
        name: 'race-test',
        node: { id: 999 },
        metadata: { stars: 2 },
        fetchStatus: 'ok',
      }),
    ]);

    // Neither call should reject — P2002 must not bubble out.
    for (const r of results) {
      expect(r.status).toBe('fulfilled');
    }

    // Exactly one row, regardless of who won the race.
    const all = await prisma.repository.findMany({
      where: { owner: 'test-owner', name: 'race-test' },
    });
    expect(all).toHaveLength(1);

    // One of the two metadata blobs wins; the row is internally
    // consistent (stars is 1 or 2, both valid). We assert it's
    // one of them rather than a default because both writers
    // spread their own baseData into the row.
    expect([1, 2]).toContain(all[0]?.stars);
  });
});

describe('M32.7.8 — storeRepoMetadata mirrors releases/branches into child tables', () => {
  // M32.7.8 — legacy core-refresh path (`M27_REFRESH_BY_KIND=false`,
  // today's production default) pulls releases/branches via
  // `fetchRepoCore` → `fetchVersionExtras` but previously only wrote
  // them to `repositories.metadata` JSON. `cache/read.ts` reads
  // `repo_releases` for the API response, so users saw empty release
  // data even though GitHub returned it. This block pins the fix:
  // `storeRepoMetadata({ releases, branches })` must populate the
  // child tables as a side effect.

  afterEach(async () => {
    await prisma.repoRelease.deleteMany({
      where: { repository: { owner: 'mirror-test' } },
    });
    await prisma.repoBranch.deleteMany({
      where: { repository: { owner: 'mirror-test' } },
    });
    await prisma.repository.deleteMany({ where: { owner: 'mirror-test' } });
    await prisma.refreshJob.deleteMany({ where: { owner: 'mirror-test' } });
  });
  afterAll(async () => {
    await prisma.repoRelease.deleteMany({
      where: { repository: { owner: 'mirror-test' } },
    });
    await prisma.repoBranch.deleteMany({
      where: { repository: { owner: 'mirror-test' } },
    });
    await prisma.repository.deleteMany({ where: { owner: 'mirror-test' } });
    await prisma.refreshJob.deleteMany({ where: { owner: 'mirror-test' } });
    await prisma.$disconnect();
  });

  it('writes passed releases to the repo_releases child table', async () => {
    const releases = [
      {
        tag_name: 'v1.0.0',
        name: 'Release 1.0.0',
        published_at: '2026-01-15T10:00:00Z',
        html_url: 'https://github.com/m/r/releases/tag/v1.0.0',
        prerelease: false,
        draft: false,
        tarball_url: null,
        zipball_url: null,
        assets_count: 0,
      },
      {
        tag_name: 'v0.9.0',
        name: 'Release 0.9.0',
        published_at: '2025-12-01T10:00:00Z',
        html_url: 'https://github.com/m/r/releases/tag/v0.9.0',
        prerelease: false,
        draft: false,
        tarball_url: null,
        zipball_url: null,
        assets_count: 2,
      },
    ];

    await storeRepoMetadata({
      owner: 'mirror-test',
      name: 'with-releases',
      node: { id: 1 },
      metadata: { recentReleases: releases, releaseCount: 2 },
      releases,
      fetchStatus: 'ok',
    });

    const rows = await prisma.repoRelease.findMany({
      where: { repository: { owner: 'mirror-test', name: 'with-releases' } },
      orderBy: { publishedAt: 'desc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.tag).toBe('v1.0.0');
    expect(rows[0]?.name).toBe('Release 1.0.0');
    expect(rows[1]?.tag).toBe('v0.9.0');
    // RepoRelease schema doesn't carry assetsCount — that field stays
    // in metadata JSON. We only pin what the child table actually stores.
    expect(rows[1]?.prerelease).toBe(false);
    expect(rows[1]?.draft).toBe(false);
  });

  it('writes passed branches to the repo_branches child table', async () => {
    const branches = [
      {
        name: 'main',
        protected: true,
        commit_sha: 'abc123',
      },
      {
        name: 'develop',
        protected: false,
        commit_sha: 'def456',
      },
    ];

    await storeRepoMetadata({
      owner: 'mirror-test',
      name: 'with-branches',
      node: { id: 2 },
      metadata: { branches },
      branches,
      fetchStatus: 'ok',
    });

    const rows = await prisma.repoBranch.findMany({
      where: { repository: { owner: 'mirror-test', name: 'with-branches' } },
      orderBy: { name: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name)).toEqual(['develop', 'main']);
    // RepoBranch.commitSha → prisma `lastCommitSha` mapping.
    expect(rows.find((r) => r.name === 'main')?.lastCommitSha).toBe('abc123');
    expect(rows.find((r) => r.name === 'main')?.protected).toBe(true);
  });

  it('does NOT touch child tables when releases/branches are absent', async () => {
    // Legacy callers (tests, dev-fetch, error paths) don't pass releases.
    // The child-table mirror must be a no-op so empty inputs don't
    // accidentally wipe existing rows.
    await storeRepoMetadata({
      owner: 'mirror-test',
      name: 'no-facets',
      node: { id: 3 },
      metadata: { stars: 42 },
      fetchStatus: 'ok',
    });

    const releases = await prisma.repoRelease.findMany({
      where: { repository: { owner: 'mirror-test', name: 'no-facets' } },
    });
    const branches = await prisma.repoBranch.findMany({
      where: { repository: { owner: 'mirror-test', name: 'no-facets' } },
    });
    expect(releases).toHaveLength(0);
    expect(branches).toHaveLength(0);
  });

  it('replaces existing child rows on second storeRepoMetadata call', async () => {
    const r1 = [
      {
        tag_name: 'v1',
        name: 'one',
        published_at: '2026-01-01T00:00:00Z',
        html_url: 'x',
        prerelease: false,
        draft: false,
        tarball_url: null,
        zipball_url: null,
        assets_count: 0,
      },
    ];
    const r2 = [
      {
        tag_name: 'v2',
        name: 'two',
        published_at: '2026-02-01T00:00:00Z',
        html_url: 'y',
        prerelease: false,
        draft: false,
        tarball_url: null,
        zipball_url: null,
        assets_count: 0,
      },
      {
        tag_name: 'v3',
        name: 'three',
        published_at: '2026-03-01T00:00:00Z',
        html_url: 'z',
        prerelease: false,
        draft: false,
        tarball_url: null,
        zipball_url: null,
        assets_count: 0,
      },
    ];

    await storeRepoMetadata({
      owner: 'mirror-test',
      name: 'replace-test',
      node: { id: 4 },
      metadata: {},
      releases: r1,
      fetchStatus: 'ok',
    });
    await storeRepoMetadata({
      owner: 'mirror-test',
      name: 'replace-test',
      node: { id: 4 },
      metadata: {},
      releases: r2,
      fetchStatus: 'ok',
    });

    const rows = await prisma.repoRelease.findMany({
      where: { repository: { owner: 'mirror-test', name: 'replace-test' } },
      orderBy: { publishedAt: 'asc' },
    });
    // r1 was wholesale replaced by r2 (deleteMany + createMany).
    expect(rows.map((r) => r.tag)).toEqual(['v2', 'v3']);
  });
});
