import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Octokit } from '@octokit/rest';
import { fetchRepoCore } from '@/lib/github/client';

// Hoist the pickToken queue so vi.mock factory and test bodies share it
const pickQueue = vi.hoisted(() => {
  const queue: Array<{ id: bigint; octokit: Octokit } | null> = [];
  return {
    queue,
    reset() {
      queue.length = 0;
    },
    push(t: { id: bigint; octokit: Octokit } | null) {
      queue.push(t);
    },
  };
});

vi.mock('@/lib/github/pool', () => ({
  initPool: vi.fn(() => Promise.resolve()),
  pickToken: vi.fn(() => {
    if (pickQueue.queue.length === 0) return null;
    return pickQueue.queue.shift() ?? null;
  }),
  recordUsage: vi.fn(() => Promise.resolve()),
  getBackoff: vi.fn(() => 10), // tiny backoff for tests
  shutdownPool: vi.fn(() => Promise.resolve()),
  poolSize: vi.fn(() => pickQueue.queue.length + 1),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Default MSW handler — override per test with server.use()
const fakeOctokit = (): Octokit => new Octokit({ auth: 'ghp_test_fake_token' });

const server = setupServer(
  http.get('https://api.github.com/repos/:owner/:name', () =>
    HttpResponse.json(
      { name: 'react', stargazers_count: 200000, default_branch: 'main' },
      { headers: { etag: 'W/"abc"', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '9999999999' } },
    ),
  ),
  // M20.8 — release + branch handlers default to empty arrays so existing
  // tests continue to pass. New tests for version capture override these.
  http.get('https://api.github.com/repos/:owner/:name/releases', () =>
    HttpResponse.json([]),
  ),
  http.get('https://api.github.com/repos/:owner/:name/branches', () =>
    HttpResponse.json([]),
  ),
);

describe('fetchRepoCore (pool-based)', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => server.close());

  beforeEach(() => {
    pickQueue.reset();
    server.resetHandlers();
  });

  it('returns data and etag on first try', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    const r = await fetchRepoCore('facebook', 'react');
    expect(r.data).toMatchObject({ name: 'react' });
    expect(r.etag).toBe('W/"abc"');
  });

  it('rotates to next token on 403 with remaining=0', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    pickQueue.push({ id: BigInt(2), octokit: fakeOctokit() });

    let callCount = 0;
    server.use(
      http.get('https://api.github.com/repos/:owner/:name', () => {
        callCount += 1;
        if (callCount === 1) {
          return HttpResponse.json(
            { message: 'API rate limit exceeded' },
            { status: 403, headers: { 'x-ratelimit-remaining': '0' } },
          );
        }
        return HttpResponse.json(
          { name: 'react' },
          { headers: { etag: 'W/"xyz"' } },
        );
      }),
    );

    const r = await fetchRepoCore('facebook', 'react');
    expect(r.data).toMatchObject({ name: 'react' });
    expect(callCount).toBe(2);
  });

  it('backs off and retries on 429', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    pickQueue.push({ id: BigInt(2), octokit: fakeOctokit() });

    let callCount = 0;
    server.use(
      http.get('https://api.github.com/repos/:owner/:name', () => {
        callCount += 1;
        if (callCount === 1) {
          return HttpResponse.json(
            { message: 'rate limit' },
            { status: 429, headers: { 'retry-after': '1' } },
          );
        }
        return HttpResponse.json({ name: 'react' }, { headers: { etag: 'W/"ok"' } });
      }),
    );

    const r = await fetchRepoCore('facebook', 'react');
    expect(r.data).toMatchObject({ name: 'react' });
    expect(callCount).toBe(2);
  });

  it('throws NotFoundError on 404', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(
      http.get('https://api.github.com/repos/:owner/:name', () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
    );
    await expect(fetchRepoCore('foo', 'bar')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws GitHubError on 403 without exhaustion', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    server.use(
      http.get('https://api.github.com/repos/:owner/:name', () =>
        HttpResponse.json(
          { message: 'Forbidden' },
          { status: 403, headers: { 'x-ratelimit-remaining': '500' } },
        ),
      ),
    );
    await expect(fetchRepoCore('foo', 'bar')).rejects.toMatchObject({
      code: 'GH_FORBIDDEN',
    });
  });

  it('throws GitHubUnavailable when pool returns null', async () => {
    // pickQueue is empty → pickToken returns null
    await expect(fetchRepoCore('foo', 'bar')).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
    });
  });

  it('throws GitHubUnavailable when 3 tokens all return 403+0', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });
    pickQueue.push({ id: BigInt(2), octokit: fakeOctokit() });
    pickQueue.push({ id: BigInt(3), octokit: fakeOctokit() });

    server.use(
      http.get('https://api.github.com/repos/:owner/:name', () =>
        HttpResponse.json(
          { message: 'rate limit' },
          { status: 403, headers: { 'x-ratelimit-remaining': '0' } },
        ),
      ),
    );

    await expect(fetchRepoCore('foo', 'bar')).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
    });
  });

  it('records usage on success', async () => {
    pickQueue.push({ id: BigInt(42), octokit: fakeOctokit() });
    const { recordUsage } = await import('@/lib/github/pool');
    const r = await fetchRepoCore('facebook', 'react');
    expect(r.data).toMatchObject({ name: 'react' });
    expect(recordUsage).toHaveBeenCalledWith(BigInt(42), 4999, expect.any(Number));
  });
});

describe('fetchRepoCore — M20.8 version + branch capture', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => server.close());

  beforeEach(() => {
    pickQueue.reset();
    server.resetHandlers();
  });

  it('returns releases + branches arrays on 200', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });

    server.use(
      http.get('https://api.github.com/repos/:owner/:name', () =>
        HttpResponse.json(
          { name: 'react', default_branch: 'main' },
          { headers: { etag: 'W/"v2"' } },
        ),
      ),
      http.get('https://api.github.com/repos/:owner/:name/releases', () =>
        HttpResponse.json([
          {
            tag_name: 'v18.0.0',
            name: '18.0.0',
            published_at: '2026-01-01T00:00:00Z',
            html_url: 'https://github.com/facebook/react/releases/tag/v18.0.0',
            prerelease: false,
            draft: false,
            tarball_url: 'https://api.github.com/facebook/react/tarball/v18.0.0',
            zipball_url: 'https://api.github.com/facebook/react/zipball/v18.0.0',
            assets: [{ name: 'a' }, { name: 'b' }],
          },
        ]),
      ),
      http.get('https://api.github.com/repos/:owner/:name/branches', () =>
        HttpResponse.json([
          { name: 'main', protected: true, commit: { sha: 'aaa111' } },
          { name: 'v17.x', protected: false, commit: { sha: 'bbb222' } },
        ]),
      ),
    );

    const r = await fetchRepoCore('facebook', 'react');
    expect(r.releases).toHaveLength(1);
    expect(r.releases![0]!.tag_name).toBe('v18.0.0');
    expect(r.releases![0]!.assets_count).toBe(2);
    expect(r.branches).toHaveLength(2);
    expect(r.branches![0]!.name).toBe('main');
    expect(r.branches![0]!.commit_sha).toBe('aaa111');
  });

  it('omits releases + branches on 304 (no extra API calls)', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });

    let releasesCalls = 0;
    let branchesCalls = 0;
    server.use(
      // Main repo endpoint returns 304 — Octokit throws with status=304,
      // which our catch block translates to `{notModified: true}`.
      http.get('https://api.github.com/repos/:owner/:name', () =>
        new HttpResponse(null, { status: 304, headers: { etag: 'W/"v1"' } }),
      ),
      http.get('https://api.github.com/repos/:owner/:name/releases', () => {
        releasesCalls += 1;
        return HttpResponse.json([]);
      }),
      http.get('https://api.github.com/repos/:owner/:name/branches', () => {
        branchesCalls += 1;
        return HttpResponse.json([]);
      }),
    );

    const r = await fetchRepoCore('facebook', 'react', 'W/"v1"');
    expect(r.notModified).toBe(true);
    expect(r.releases).toBeUndefined();
    expect(r.branches).toBeUndefined();
    expect(releasesCalls).toBe(0);
    expect(branchesCalls).toBe(0);
  });

  it('returns empty arrays when listReleases / listBranches fail (non-fatal)', async () => {
    pickQueue.push({ id: BigInt(1), octokit: fakeOctokit() });

    server.use(
      http.get('https://api.github.com/repos/:owner/:name', () =>
        HttpResponse.json(
          { name: 'react', default_branch: 'main' },
          { headers: { etag: 'W/"v3"' } },
        ),
      ),
      // Both endpoints fail — the main fetch should still succeed and return
      // empty arrays for releases + branches (Promise.allSettled fallback).
      http.get('https://api.github.com/repos/:owner/:name/releases', () =>
        HttpResponse.json({ message: 'internal' }, { status: 500 }),
      ),
      http.get('https://api.github.com/repos/:owner/:name/branches', () =>
        HttpResponse.json({ message: 'internal' }, { status: 500 }),
      ),
    );

    const r = await fetchRepoCore('facebook', 'react');
    expect(r.data).toMatchObject({ name: 'react' });
    expect(r.releases).toEqual([]);
    expect(r.branches).toEqual([]);
  });
});