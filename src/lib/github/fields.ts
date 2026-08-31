/**
 * M20.8 — version + branch projections added so the metadata JSON column
 * carries complete GitHub cache data: not just the 16 static fields but also
 * the latest release (with assets count), the top-N recent releases, total
 * release count, and the top-N branches.
 *
 * The full raw response is also stored separately in `repositories.node`,
 * so consumers that need fields not projected here can still read them.
 */

export interface ReleaseProjection {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  tarball_url: string | null;
  zipball_url: string | null;
  assets_count: number;
}

export interface BranchProjection {
  name: string;
  protected: boolean;
  commit_sha: string;
}

export interface RepoCoreData {
  name: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  stars: number;
  forks: number;
  watchers: number;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
  language: string | null;
  license: string | null;
  topics: string[];
  homepage: string | null;
  archived: boolean;
  disabled: boolean;
  // M20.8 additions — version + branch data so the cache answers
  // "what's the latest version of this repo?" without a fresh GitHub fetch.
  /**
   * GitHub nests the latest published release inside the repo response as
   * `latest_release`. `null` when the repo has zero releases.
   */
  latestRelease: ReleaseProjection | null;
  /**
   * Top-10 most recent published releases (incl. prereleases + drafts).
   * Empty array when the repo has zero releases or fetchVersionExtras failed.
   */
  recentReleases: ReleaseProjection[];
  /**
   * Total release count returned by GitHub. May exceed recentReleases.length
   * for repos with > 10 releases. `0` when the repo has zero releases.
   */
  releaseCount: number;
  /**
   * Top-20 branches (alphabetical + default from GitHub). Empty array when
   * fetchVersionExtras failed.
   */
  branches: BranchProjection[];
}

interface RawRepoResponse {
  name?: unknown;
  description?: unknown;
  private?: unknown;
  default_branch?: unknown;
  stargazers_count?: unknown;
  forks_count?: unknown;
  subscribers_count?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  pushed_at?: unknown;
  language?: unknown;
  license?: { spdx_id?: unknown } | null;
  topics?: unknown;
  homepage?: unknown;
  archived?: unknown;
  disabled?: unknown;
  /**
   * GitHub nests the most recent published release here. Null when the repo
   * has no published releases. We use this to populate `latestRelease`.
   */
  latest_release?: unknown;
}

interface RawReleaseItem {
  tag_name?: unknown;
  name?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  prerelease?: unknown;
  draft?: unknown;
  tarball_url?: unknown;
  zipball_url?: unknown;
  assets?: unknown;
}

interface RawBranchItem {
  name?: unknown;
  protected?: unknown;
  commit?: { sha?: unknown };
}

function parseRelease(raw: unknown): ReleaseProjection {
  const r = raw as RawReleaseItem;
  const assets = Array.isArray(r.assets) ? r.assets : [];
  return {
    tag_name: String(r.tag_name ?? ''),
    name: (r.name ?? null) as string | null,
    published_at: (r.published_at ?? null) as string | null,
    html_url: String(r.html_url ?? ''),
    prerelease: Boolean(r.prerelease),
    draft: Boolean(r.draft),
    tarball_url: (r.tarball_url ?? null) as string | null,
    zipball_url: (r.zipball_url ?? null) as string | null,
    assets_count: assets.length,
  };
}

function parseBranch(raw: unknown): BranchProjection {
  const r = raw as RawBranchItem;
  return {
    name: String(r.name ?? ''),
    protected: Boolean(r.protected),
    commit_sha: String(r.commit?.sha ?? ''),
  };
}

/**
 * Parse the raw GitHub repo response into the slim metadata projection, and
 * merge in the latest-release from `latest_release` plus the top-N releases
 * / branches fetched in `fetchVersionExtras`.
 *
 * Note: when `latest_release` is null on the repo response (repo has zero
 * releases) but `rawReleases` is non-empty (e.g. all releases are drafts),
 * we still surface `recentReleases` + `releaseCount` — but `latestRelease`
 * stays `null` because GitHub explicitly says there is no published release.
 *
 * @param rawRepo     - the raw GitHub `/repos/{owner}/{name}` response
 * @param rawReleases - the raw array from `/repos/{owner}/{name}/releases`
 * @param rawBranches - the raw array from `/repos/{owner}/{name}/branches`
 */
export function parseRepoResponse(
  rawRepo: unknown,
  rawReleases: unknown[] = [],
  rawBranches: unknown[] = [],
): RepoCoreData {
  const r = rawRepo as RawRepoResponse;
  return {
    name: String(r.name ?? ''),
    description: (r.description ?? null) as string | null,
    private: Boolean(r.private),
    defaultBranch: String(r.default_branch ?? 'main'),
    stars: Number(r.stargazers_count ?? 0),
    forks: Number(r.forks_count ?? 0),
    watchers: Number(r.subscribers_count ?? 0),
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
    pushedAt: (r.pushed_at ?? null) as string | null,
    language: (r.language ?? null) as string | null,
    license: r.license?.spdx_id != null ? String(r.license.spdx_id) : null,
    topics: Array.isArray(r.topics) ? (r.topics as unknown[]).map(String) : [],
    homepage: (r.homepage ?? null) as string | null,
    archived: Boolean(r.archived),
    disabled: Boolean(r.disabled),
    latestRelease:
      r.latest_release !== undefined && r.latest_release !== null
        ? parseRelease(r.latest_release)
        : null,
    recentReleases: rawReleases.map(parseRelease),
    releaseCount: rawReleases.length,
    branches: rawBranches.map(parseBranch),
  };
}