/**
 * Helpers for reading metadata stored by `parseRepoResponse`.
 *
 * The cache stores the *parsed* shape (see @/lib/github/fields), not raw
 * GitHub API responses. Detail / lookup-result components read these fields
 * via the helpers below so they keep working when parseRepoResponse evolves.
 */

import type { QueryResult } from '@/lib/cache/lookup';

interface ParsedLicense {
  name?: unknown;
  spdx_id?: unknown;
}

export interface ParsedRepoMetadata {
  name?: unknown;
  description?: unknown;
  private?: unknown;
  defaultBranch?: unknown;
  stars?: unknown;
  forks?: unknown;
  watchers?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  pushedAt?: unknown;
  language?: unknown;
  license?: unknown;
  topics?: unknown;
  homepage?: unknown;
  archived?: unknown;
  disabled?: unknown;
  // M24 — release + branch projections (cached by M20.8 parseRepoResponse).
  releaseCount?: unknown;
  latestRelease?: unknown;
  recentReleases?: unknown;
  branches?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function asParsed(meta: unknown): ParsedRepoMetadata {
  return isObject(meta) ? (meta as ParsedRepoMetadata) : {};
}

export function getDescription(meta: unknown): string | null {
  const d = asParsed(meta).description;
  return typeof d === 'string' ? d : null;
}

export function getStars(meta: unknown): number | null {
  const n = asParsed(meta).stars;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function getForks(meta: unknown): number | null {
  const n = asParsed(meta).forks;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function getWatchers(meta: unknown): number | null {
  const n = asParsed(meta).watchers;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function getDefaultBranch(meta: unknown): string | null {
  const s = asParsed(meta).defaultBranch;
  return typeof s === 'string' && s.length > 0 ? s : null;
}

export function getLanguage(meta: unknown): string | null {
  const s = asParsed(meta).language;
  return typeof s === 'string' && s.length > 0 ? s : null;
}

export function getLicenseName(meta: unknown): string | null {
  const v = asParsed(meta).license;
  if (typeof v === 'string' && v.length > 0) return v;
  if (isObject(v)) {
    const lic = v as ParsedLicense;
    const spdx = lic.spdx_id;
    const name = lic.name;
    if (typeof spdx === 'string' && spdx.length > 0) return spdx;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return null;
}

export function getTopics(meta: unknown): string[] {
  const topics = asParsed(meta).topics;
  if (!Array.isArray(topics)) return [];
  return topics.filter((t): t is string => typeof t === 'string');
}

export function getHomepage(meta: unknown): string | null {
  const s = asParsed(meta).homepage;
  return typeof s === 'string' && s.length > 0 ? s : null;
}

export function getCreatedAt(meta: unknown): string | null {
  const s = asParsed(meta).createdAt;
  return typeof s === 'string' && s.length > 0 ? s : null;
}

export function getUpdatedAt(meta: unknown): string | null {
  const s = asParsed(meta).updatedAt;
  return typeof s === 'string' && s.length > 0 ? s : null;
}

export function getPushedAt(meta: unknown): string | null {
  const s = asParsed(meta).pushedAt;
  return typeof s === 'string' && s.length > 0 ? s : null;
}

export function getSizeKb(meta: unknown): number | null {
  // Not currently captured by parseRepoResponse — reserved hook for future
  // addition (e.g. when /repos endpoint is replaced by /repos/{owner}/{name}).
  void meta;
  return null;
}

export function getArchived(meta: unknown): boolean {
  return asParsed(meta).archived === true;
}

export function getDisabled(meta: unknown): boolean {
  return asParsed(meta).disabled === true;
}

/**
 * Whether the GitHub repo is marked private. Public repos surface this
 * as `false`; private repos as `true`. The cache stores private=true
 * only when the upstream repo really is private (the fetch would have
 * failed otherwise, so we can trust the flag).
 */
export function getPrivate(meta: unknown): boolean {
  return asParsed(meta).private === true;
}

/**
 * Total number of releases GitHub returned for this repo. May exceed
 * recentReleases.length (we cap to 10). 0 when the repo has no releases
 * or fetchVersionExtras failed.
 */
export function getReleaseCount(meta: unknown): number {
  const n = asParsed(meta).releaseCount;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

export interface ReleaseSummary {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  assets_count: number;
}

function asRelease(raw: unknown): ReleaseSummary | null {
  if (!isObject(raw)) return null;
  const r = raw as Record<string, unknown>;
  const tag = r.tag_name;
  if (typeof tag !== 'string' || tag.length === 0) return null;
  const html = r.html_url;
  return {
    tag_name: tag,
    name: typeof r.name === 'string' ? r.name : null,
    published_at: typeof r.published_at === 'string' ? r.published_at : null,
    html_url: typeof html === 'string' ? html : '',
    prerelease: r.prerelease === true,
    draft: r.draft === true,
    assets_count:
      typeof r.assets_count === 'number' && Number.isFinite(r.assets_count)
        ? r.assets_count
        : 0,
  };
}

/**
 * Most recent *published* release (GitHub's `latest_release` projection).
 * `null` when the repo has zero published releases — even if
 * `recentReleases` contains drafts.
 */
export function getLatestRelease(meta: unknown): ReleaseSummary | null {
  return asRelease(asParsed(meta).latestRelease);
}

/**
 * Top-N recent releases (GitHub caps our fetch at 10). Empty when the
 * repo has zero releases or fetchVersionExtras failed.
 */
export function getRecentReleases(meta: unknown): ReleaseSummary[] {
  const list = asParsed(meta).recentReleases;
  if (!Array.isArray(list)) return [];
  const out: ReleaseSummary[] = [];
  for (const r of list) {
    const release = asRelease(r);
    if (release) out.push(release);
  }
  return out;
}

export interface BranchSummary {
  name: string;
  protected: boolean;
  commit_sha: string;
}

function asBranch(raw: unknown): BranchSummary | null {
  if (!isObject(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = r.name;
  if (typeof name !== 'string' || name.length === 0) return null;
  const commit = isObject(r.commit_sha)
    ? r.commit_sha
    : { sha: typeof r.commit_sha === 'string' ? r.commit_sha : '' };
  const sha = (commit as { sha?: unknown }).sha;
  return {
    name,
    protected: r.protected === true,
    commit_sha: typeof sha === 'string' ? sha : '',
  };
}

/**
 * Top-N branches (GitHub caps our fetch at 20). Empty when the repo
 * has zero branches cached or fetchVersionExtras failed.
 */
export function getBranches(meta: unknown): BranchSummary[] {
  const list = asParsed(meta).branches;
  if (!Array.isArray(list)) return [];
  const out: BranchSummary[] = [];
  for (const r of list) {
    const branch = asBranch(r);
    if (branch) out.push(branch);
  }
  return out;
}

/**
 * Integer years between `createdAt` and `now`. Returns `null` for missing
 * / unparseable timestamps and for future dates (createdAt > now means
 * the cache is stale and we shouldn't display "Created -1 years ago").
 *
 * Extracted to a non-component helper so `Date.now()` doesn't trip the
 * react-hooks/purity lint rule inside server components.
 */
export function getRepoAgeYears(createdAt: string | null): number | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return null;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return null;
  return Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000));
}

/**
 * 3-letter label for a QueryResult — used by the [OK]/[404]/[ERR] badge
 * in lookup-result-card (terminal theme signature element).
 */
export function getFetchStatusLabel(r: QueryResult): string {
  if (r.fetch_status === 'not_found') return '404';
  if (r.fetch_status === 'error') return 'ERR';
  return 'OK';
}

export function getHtmlUrl(owner: string, name: string): string {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export function formatCount(n: number | null): string {
  if (n === null) return '–';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '–';
  const t = typeof d === 'string' ? Date.parse(d) : d.getTime();
  if (Number.isNaN(t)) return '–';
  return new Date(t).toISOString().slice(0, 10);
}