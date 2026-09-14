import { describe, it, expect } from 'vitest';
import { bucketRepoNode } from '@/lib/admin/repo-node-sections';

/**
 * Unit tests for the bucketRepoNode helper used by
 * /admin/repositories/[owner]/[name] to split a GitHub `node` blob
 * into operator-meaningful groups (stats / license / owner / ...).
 *
 * What we verify:
 *   - empty / null / non-object input → empty bucket list
 *   - stats bucket is defaultOpen
 *   - license/owner/permissions/urls go to their own buckets
 *   - `*_url` template fields land in `urls`, not leaked into misc
 *   - unknown fields land in `misc` (never silently dropped)
 *   - all input keys are accounted for (consumed + urls + misc = total)
 */

const SAMPLE_NODE = {
  // identity
  id: 1,
  node_id: 'MDEwOlJlcG9zaXRvcnkx',
  name: 'fastapi',
  full_name: 'tiangolo/fastapi',
  html_url: 'https://github.com/tiangolo/fastapi',
  url: 'https://api.github.com/repos/tiangolo/fastapi',
  fork: false,

  // visibility
  private: false,
  visibility: 'public',
  archived: false,
  disabled: false,
  has_issues: true,
  allow_forking: true,
  web_commit_signoff_required: false,

  // stats
  stargazers_count: 70000,
  watchers_count: 70000,
  forks_count: 9874,
  open_issues_count: 50,
  size: 55416,

  // timestamps
  created_at: '2018-08-19T13:23:23Z',
  updated_at: '2026-09-13T00:00:00Z',
  pushed_at: '2026-09-12T20:00:00Z',

  // content
  default_branch: 'master',
  description: 'FastAPI framework',
  homepage: '',
  language: 'Python',

  // license + topics
  license: { key: 'mit', name: 'MIT License', spdx_id: 'MIT' },
  topics: ['python', 'api'],

  // owner
  owner: {
    login: 'tiangolo',
    id: 200,
    type: 'User',
    avatar_url: 'https://avatars.githubusercontent.com/u/200',
  },

  // permissions
  permissions: { pull: true, push: false, admin: false },

  // url templates (38 in real GitHub response — sample a few)
  archive_url: 'https://api.github.com/repos/{}/{}/archive/{}.tarball',
  assignees_url: 'https://api.github.com/repos/{}/{}/assignees{/user}',
  branches_url: 'https://api.github.com/repos/{}/{}/branches{/branch}',

  // misc
  mirror_url: null,
  temp_clone_token: '',

  // brand-new GitHub field we haven't classified
  brand_new_flag: 'surprise',
};

describe('bucketRepoNode', () => {
  it('returns [] for null / non-object input', () => {
    expect(bucketRepoNode(null)).toEqual([]);
    expect(bucketRepoNode('string')).toEqual([]);
    expect(bucketRepoNode(42)).toEqual([]);
    expect(bucketRepoNode([1, 2, 3])).toEqual([]);
  });

  it('returns [] for empty object', () => {
    expect(bucketRepoNode({})).toEqual([]);
  });

  it('puts the stats bucket first and opens it by default', () => {
    const buckets = bucketRepoNode(SAMPLE_NODE);
    expect(buckets[0]?.id).toBe('stats');
    expect(buckets[0]?.defaultOpen).toBe(true);
  });

  it('separates stats / license / owner / permissions into distinct buckets', () => {
    const buckets = bucketRepoNode(SAMPLE_NODE);
    const ids = buckets.map((b) => b.id);
    expect(ids).toContain('stats');
    expect(ids).toContain('identity');
    expect(ids).toContain('visibility');
    expect(ids).toContain('timestamps');
    expect(ids).toContain('content');
    expect(ids).toContain('license');
    expect(ids).toContain('owner');
    expect(ids).toContain('permissions');
  });

  it('routes every `*_url` field to the urls bucket (not misc)', () => {
    const buckets = bucketRepoNode(SAMPLE_NODE);
    const urlsBucket = buckets.find((b) => b.id === 'urls');
    expect(urlsBucket).toBeDefined();
    expect(urlsBucket?.keys).toEqual(
      expect.arrayContaining(['archive_url', 'assignees_url', 'branches_url']),
    );

    // owner.avatar_url is a nested url — bucketRepoNode only splits
    // top-level keys, so it stays inside the owner bucket. That's
    // intentional (a deep crawl would explode the API surface we
    // promise to render).
    const ownerBucket = buckets.find((b) => b.id === 'owner');
    expect(ownerBucket?.data.owner).toMatchObject({
      avatar_url: 'https://avatars.githubusercontent.com/u/200',
    });
  });

  it('routes unknown fields into `misc` (never silently dropped)', () => {
    const buckets = bucketRepoNode(SAMPLE_NODE);
    const misc = buckets.find((b) => b.id === 'misc');
    expect(misc?.keys).toContain('brand_new_flag');
    expect(misc?.data.brand_new_flag).toBe('surprise');
  });

  it('consumes every top-level key across all buckets', () => {
    const buckets = bucketRepoNode(SAMPLE_NODE);
    const accountedFor = new Set<string>();
    for (const b of buckets) {
      for (const k of b.keys) accountedFor.add(k);
    }
    const inputKeys = Object.keys(SAMPLE_NODE);
    // every input key is in some bucket (no silent drops)
    for (const k of inputKeys) {
      expect(accountedFor.has(k)).toBe(true);
    }
  });

  it('omits a bucket entirely when none of its keys are present', () => {
    // No license / owner / permissions / urls here → those buckets
    // shouldn't render at all.
    const minimal = bucketRepoNode({
      stargazers_count: 10,
      forks_count: 1,
      name: 'x',
    });
    const ids = minimal.map((b) => b.id);
    expect(ids).toEqual(['stats', 'identity']);
    expect(ids).not.toContain('license');
    expect(ids).not.toContain('owner');
    expect(ids).not.toContain('permissions');
    expect(ids).not.toContain('urls');
    expect(ids).not.toContain('misc');
  });

  it('stats bucket counts only the keys that are present', () => {
    const buckets = bucketRepoNode({
      stargazers_count: 10,
      forks_count: 1,
      // no watchers, no open_issues, no size, no network_count
    });
    const stats = buckets.find((b) => b.id === 'stats');
    expect(stats?.keys).toEqual(['stargazers_count', 'forks_count']);
    expect(stats?.data).toEqual({
      stargazers_count: 10,
      forks_count: 1,
    });
  });

  it('keeps nested objects intact within their parent bucket', () => {
    const buckets = bucketRepoNode(SAMPLE_NODE);
    const ownerBucket = buckets.find((b) => b.id === 'owner');
    expect(ownerBucket?.data.owner).toEqual({
      login: 'tiangolo',
      id: 200,
      type: 'User',
      avatar_url: 'https://avatars.githubusercontent.com/u/200',
    });
    const licenseBucket = buckets.find((b) => b.id === 'license');
    expect(licenseBucket?.data.license).toEqual({
      key: 'mit',
      name: 'MIT License',
      spdx_id: 'MIT',
    });
  });
});