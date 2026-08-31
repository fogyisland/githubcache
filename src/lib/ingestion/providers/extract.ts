/**
 * GitHub URL parser for M19 ingestion.
 *
 * Given any string pulled from a provider's items, return the
 * owner + name pair if it parses as a GitHub repo URL; otherwise null.
 *
 * Accepted forms (case-insensitive on the host):
 *   https://github.com/owner/name
 *   https://github.com/owner/name.git
 *   http://github.com/owner/name
 *   github.com/owner/name          (no scheme)
 *   git@github.com:owner/name.git  (SSH shorthand)
 *
 * Owner and name are restricted to GitHub's character set
 * (alphanumeric, dot, underscore, hyphen). Trailing slashes and ".git"
 * suffix are normalized away.
 *
 * Returns null for:
 *   - non-string input
 *   - empty / whitespace-only input
 *   - URLs that don't match any of the above patterns (e.g. GitLab,
 *     Bitbucket, or malformed GitHub URLs with missing owner/name)
 */

const URL_RE = /^(?:https?:\/\/)?github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i;
const SSH_RE = /^git@github\.com:([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/i;

export function parseGitHubUrl(input: unknown): { owner: string; name: string } | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const m = URL_RE.exec(trimmed) ?? SSH_RE.exec(trimmed);
  if (!m) return null;
  const owner = m[1]!;
  const name = m[2]!;
  if (owner.length === 0 || name.length === 0) return null;
  return { owner, name };
}