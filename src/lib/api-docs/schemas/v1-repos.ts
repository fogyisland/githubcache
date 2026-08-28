import { z } from 'zod';

/**
 * Schema for GET /api/v1/repos/{owner}/{name} response payload.
 *
 * Mirrors the actual wire format produced by
 * src/app/api/v1/repos/[owner]/[name]/route.ts (M12.1). The route wraps
 * lookupRepo's output into three discriminated variants; the 'ok' branch
 * embeds the full RepoCoreData (from src/lib/github/fields.ts) while the
 * 'not_found' / 'error' branches embed only { owner, name } (from the URL
 * path).
 *
 * No `canonical` field is emitted over the wire (it's an internal
 * QueryResult field dropped by the route handler). The error variants
 * use `error` (not the plan's `reason` / `code` / `message`).
 */

// Mirrors src/lib/github/fields.ts:RepoCoreData. NO `owner` — owner lives
// only in the URL path, never in the cached metadata.
const repoMetadataSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  private: z.boolean().describe('True if the repo is private on GitHub.'),
  defaultBranch: z.string().describe("GitHub's default_branch for this repo."),
  stars: z.number().int(),
  forks: z.number().int(),
  watchers: z.number().int().describe('GitHub subscribers_count (watchers).'),
  createdAt: z.string().describe('ISO 8601 timestamp from GitHub.'),
  updatedAt: z.string().describe('ISO 8601 timestamp from GitHub.'),
  pushedAt: z.string().nullable().describe('ISO 8601 timestamp; null if the repo has no pushes.'),
  language: z.string().nullable(),
  license: z.string().nullable().describe('SPDX license id, e.g. "MIT".'),
  topics: z.array(z.string()),
  homepage: z.string().nullable(),
  archived: z.boolean(),
  disabled: z.boolean(),
}).describe('Repository metadata, mirroring RepoCoreData from src/lib/github/fields.ts.');

// Lightweight { owner, name } wrapper used in non-ok branches where we have
// no metadata to return.
const repoRefSchema = z.object({
  owner: z.string().describe('Echoed from the URL path.'),
  name: z.string().describe('Echoed from the URL path.'),
});

export const v1ReposOkSchema = z.object({
  fetch_status: z.literal('ok'),
  repository: repoMetadataSchema,
  fetched_at: z.string().nullable().describe('ISO 8601 timestamp of the last successful GitHub fetch; null if never fetched.'),
  stale: z.boolean().optional().describe('True if the cached row is past its refresh TTL.'),
  warning: z.string().optional().describe('Set to STALE_WARNING constant when stale=true.'),
});

export const v1ReposNotFoundSchema = z.object({
  fetch_status: z.literal('not_found'),
  repository: repoRefSchema,
  error: z.string().describe('Human-readable reason, e.g. "Repository not found or private".'),
});

export const v1ReposErrorSchema = z.object({
  fetch_status: z.literal('error'),
  repository: repoRefSchema,
  error: z.string().describe('Error message from the upstream fetch attempt.'),
});

export const v1ReposResponseSchema = z.union([
  v1ReposOkSchema,
  v1ReposNotFoundSchema,
  v1ReposErrorSchema,
]);

export const v1ReposOkSample: z.infer<typeof v1ReposOkSchema> = {
  fetch_status: 'ok',
  repository: {
    name: 'Hello-World',
    description: 'My first repo on GitHub!',
    private: false,
    defaultBranch: 'master',
    stars: 2000,
    forks: 900,
    watchers: 80,
    createdAt: '2011-01-26T19:01:12Z',
    updatedAt: '2026-08-15T10:00:00Z',
    pushedAt: '2026-08-15T09:55:00Z',
    language: 'C',
    license: 'MIT',
    topics: ['demo'],
    homepage: null,
    archived: false,
    disabled: false,
  },
  fetched_at: '2026-08-27T12:00:00.000Z',
};