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