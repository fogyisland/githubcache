import { Octokit } from '@octokit/rest';
import { env } from '@/lib/config/env';
import { GitHubError, GitHubUnavailable, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';

// M1 uses single token from env. M4 replaces with per-token Octokit.
// We do NOT pass `request: { fetch }` explicitly so that Octokit resolves the
// global `fetch` at request time — this lets MSW (and other test-time
// fetch patches) intercept calls transparently.
const octokit = new Octokit({
  auth: env.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN,
});

export async function fetchRepoCore(
  owner: string,
  name: string,
): Promise<{ data: unknown; etag?: string }> {
  try {
    const res = await octokit.repos.get({ owner, repo: name });
    const etag = res.headers.etag ?? undefined;
    return etag ? { data: res.data, etag } : { data: res.data };
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    if (err?.status === 404) throw new NotFoundError(`Repo ${owner}/${name} not found`);
    if (err?.status === 403) throw new GitHubError('GH_FORBIDDEN', 403, err.message ?? 'forbidden');
    if (err?.status !== undefined && err.status >= 500)
      throw new GitHubUnavailable(`GitHub ${err.status}`);
    logger.error({ err }, 'unexpected github error');
    throw new GitHubError('GH_ERROR', err?.status ?? 500, err?.message ?? 'unknown');
  }
}