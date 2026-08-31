import { describe, it, expect } from 'vitest';
import { parseRepoResponse } from '@/lib/github/fields';

describe('parseRepoResponse', () => {
  it('normalizes core fields', () => {
    const out = parseRepoResponse({
      name: 'react',
      stargazers_count: 1,
      default_branch: 'main',
      license: { spdx_id: 'MIT' },
      topics: ['ui'],
    });
    expect(out.name).toBe('react');
    expect(out.stars).toBe(1);
    expect(out.defaultBranch).toBe('main');
    expect(out.license).toBe('MIT');
    expect(out.topics).toEqual(['ui']);
  });

  it('handles missing license and topics', () => {
    const out = parseRepoResponse({ name: 'r', default_branch: 'main' });
    expect(out.license).toBeNull();
    expect(out.topics).toEqual([]);
  });
});

describe('parseRepoResponse — M20.8 version + branches', () => {
  it('extracts latest_release when GitHub nests a published release', () => {
    const out = parseRepoResponse(
      {
        name: 'r',
        default_branch: 'main',
        latest_release: {
          tag_name: 'v1.2.3',
          name: 'Release 1.2.3',
          published_at: '2026-08-15T10:00:00Z',
          html_url: 'https://github.com/o/r/releases/tag/v1.2.3',
          prerelease: false,
          draft: false,
          tarball_url: 'https://api.github.com/o/r/tarball/v1.2.3',
          zipball_url: 'https://api.github.com/o/r/zipball/v1.2.3',
          assets: [
            { name: 'a.tar.gz', size: 100 },
            { name: 'b.zip', size: 200 },
          ],
        },
      },
      [],
      [],
    );
    expect(out.latestRelease).toEqual({
      tag_name: 'v1.2.3',
      name: 'Release 1.2.3',
      published_at: '2026-08-15T10:00:00Z',
      html_url: 'https://github.com/o/r/releases/tag/v1.2.3',
      prerelease: false,
      draft: false,
      tarball_url: 'https://api.github.com/o/r/tarball/v1.2.3',
      zipball_url: 'https://api.github.com/o/r/zipball/v1.2.3',
      assets_count: 2,
    });
  });

  it('sets latestRelease=null when repo has zero releases', () => {
    const out = parseRepoResponse(
      { name: 'r', default_branch: 'main', latest_release: null },
      [],
      [],
    );
    expect(out.latestRelease).toBeNull();
    expect(out.recentReleases).toEqual([]);
    expect(out.releaseCount).toBe(0);
  });

  it('populates recentReleases + releaseCount from listReleases', () => {
    const releases = [
      {
        tag_name: 'v1.0.0',
        name: '1.0',
        published_at: '2026-01-01T00:00:00Z',
        html_url: 'https://github.com/o/r/releases/tag/v1.0.0',
        prerelease: false,
        draft: false,
        tarball_url: null,
        zipball_url: null,
        assets: [{ name: 'a' }],
      },
      {
        tag_name: 'v1.1.0-beta',
        name: '1.1 beta',
        published_at: '2026-02-01T00:00:00Z',
        html_url: 'https://github.com/o/r/releases/tag/v1.1.0-beta',
        prerelease: true,
        draft: false,
        tarball_url: null,
        zipball_url: null,
        assets: [],
      },
    ];
    const out = parseRepoResponse({ name: 'r', default_branch: 'main' }, releases, []);
    expect(out.recentReleases).toHaveLength(2);
    expect(out.recentReleases[0]!.tag_name).toBe('v1.0.0');
    expect(out.recentReleases[1]!.prerelease).toBe(true);
    expect(out.releaseCount).toBe(2);
    // latestRelease is null because rawRepo had no `latest_release` field
    expect(out.latestRelease).toBeNull();
  });

  it('keeps recentReleases empty when listReleases returns []', () => {
    const out = parseRepoResponse({ name: 'r', default_branch: 'main' }, [], []);
    expect(out.recentReleases).toEqual([]);
    expect(out.releaseCount).toBe(0);
  });

  it('populates branches with name + protected + commit_sha', () => {
    const branches = [
      { name: 'main', protected: true, commit: { sha: 'abc123' } },
      { name: 'develop', protected: false, commit: { sha: 'def456' } },
    ];
    const out = parseRepoResponse({ name: 'r', default_branch: 'main' }, [], branches);
    expect(out.branches).toEqual([
      { name: 'main', protected: true, commit_sha: 'abc123' },
      { name: 'develop', protected: false, commit_sha: 'def456' },
    ]);
  });

  it('defaults branches[] to empty when rawBranches is omitted', () => {
    const out = parseRepoResponse({ name: 'r', default_branch: 'main' });
    expect(out.branches).toEqual([]);
  });

  it('treats malformed release payload defensively (no thrown errors)', () => {
    const out = parseRepoResponse(
      { name: 'r', default_branch: 'main' },
      // Missing almost every field — should not throw
      [{ tag_name: 'broken' }],
      // Missing commit.sha — should default to empty string
      [{ name: 'no-sha', protected: false }],
    );
    expect(out.recentReleases[0]!.tag_name).toBe('broken');
    expect(out.recentReleases[0]!.name).toBeNull();
    expect(out.recentReleases[0]!.assets_count).toBe(0);
    expect(out.branches[0]!.commit_sha).toBe('');
  });
});