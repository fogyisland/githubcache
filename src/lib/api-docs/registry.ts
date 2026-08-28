import type { EndpointDoc } from './types';
import { v1StatusSchema, v1StatusSample } from './schemas/v1-status';
import {
  v1ReposResponseSchema,
  v1ReposOkSample,
} from './schemas/v1-repos';
import {
  queryBodySchema,
  queryResponseSchema,
  querySample,
} from './schemas/query';

export const ENDPOINT_DOCS: EndpointDoc[] = [
  {
    slug: 'api/v1-status',
    path: '/api/v1/status',
    method: 'GET',
    summary: 'System status — DB, token pool, queue, repository counts, version.',
    description:
      'Read-only observability endpoint. Always public, no rate limit. Returns 503 when the DB is down so load balancers can take the instance out of rotation.',
    auth: 'none',
    rateLimit: 'none',
    response: v1StatusSchema,
    responseSamples: { default: v1StatusSample },
    errors: [
      { status: 503, error: 'service unavailable', when: 'DB unreachable (down=false).' },
    ],
  },
  {
    slug: 'api/v1-repos',
    path: '/api/v1/repos/{owner}/{name}',
    method: 'GET',
    summary: 'Fetch a single repository metadata record from the cache.',
    description:
      'Public read of the cache for a single repo. Returns the same shape as the repo detail page at /repo/[owner]/[name]. If the cache is empty, falls through to a fresh GitHub fetch.',
    auth: 'none',
    rateLimit: 'PUBLIC_LOOKUP_RATE_PER_MIN (default 30) per IP',
    request: [
      { name: 'owner', in: 'path', type: 'string', required: true, description: 'GitHub username or org.' },
      { name: 'name',  in: 'path', type: 'string', required: true, description: 'GitHub repo name.' },
    ],
    response: v1ReposResponseSchema,
    responseSamples: { default: v1ReposOkSample },
    errors: [
      { status: 404, error: 'not_found', when: 'fetch_status=not_found (GitHub returned 404 or owner/name is invalid).' },
      { status: 429, error: 'rate limit exceeded', when: 'Per-IP bucket exhausted.' },
      { status: 503, error: 'service unavailable', when: 'fetch_status=error or no GitHub tokens configured.' },
    ],
  },
  {
    slug: 'api/query',
    path: '/api/query',
    method: 'POST',
    summary: 'Batch-fetch up to 100 repositories with a single API key.',
    description:
      'Authenticated batch endpoint for API key holders. Returns results in the same order as the input nodes; partial failures are reported per-node via the discriminated union.',
    auth: 'X-API-Key',
    rateLimit: 'rateLimitPerMin (per API key, default 60) durable bucket',
    request: [
      { name: 'X-API-Key', in: 'header', type: 'string', required: true, description: 'Active API key.' },
      { name: 'nodes',     in: 'body',   type: 'Array<{ owner, name }>', required: true, description: 'Up to 100 repo refs to fetch.' },
    ],
    response: queryResponseSchema,
    responseSamples: { default: querySample },
    headers: [
      { name: 'Retry-After',          description: 'Seconds until the rate limit resets.', example: '30' },
      { name: 'X-RateLimit-Limit',    description: 'Configured per-minute ceiling.', example: '60' },
      { name: 'X-RateLimit-Remaining', description: '0 when denied, otherwise limit - count.', example: '5' },
    ],
    errors: [
      { status: 400, error: 'malformed json',         when: 'Body is not valid JSON.' },
      { status: 400, error: 'invalid nodes',          when: 'parseNodes validation failed.' },
      { status: 401, error: 'missing api key',        when: 'No X-API-Key header.' },
      { status: 403, error: 'invalid api key',        when: 'Key not found or status != active.' },
      { status: 429, error: 'rate limit exceeded',    when: 'Per-key bucket exhausted.' },
    ],
  },
];

export function findEndpointBySlug(slug: string): EndpointDoc | undefined {
  return ENDPOINT_DOCS.find((d) => d.slug === slug);
}
